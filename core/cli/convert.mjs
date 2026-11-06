/**
 * MC Studio 命令行 · 功能转换器。
 *
 *   node studio.mjs convert rules                       列规则 / 诊断
 *   node studio.mjs convert matrix                     目标之间的能力矩阵
 *   node studio.mjs convert inspect <文件|工程>          看抽出来的功能 IR
 *   node studio.mjs convert run <文件|工程> --to ID     预览转换（只读）
 *         [--from ID] [--out 文件] [--format json|java]
 *   node studio.mjs convert apply <工程> --to ID --yes  把结果落到工程（会改数据）
 *         [--generate] [--from ID]
 *
 * 所有命令返回 { exitCode, lines, data }，不自己打印 —— 与 blocks/tools 一致，
 * 测试和 CI 可以直接断言结果，不用抓 stdout。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './blocks.mjs';
import { readFeature, featureSummary } from '../convert/ir.mjs';
import {
  convert, conversionMatrix, applyConversion, convertProject,
  convertedJava, listRules, convertDiagnostics,
} from '../convert/engine.mjs';
import { listTargets } from '../target/registry.mjs';

function result(exitCode, lines, data = null) { return { exitCode, lines, data }; }
function fail(msg) { return result(1, [`  ✗ ${msg}`], { error: msg }); }

function pad(s, width) {
  const str = String(s ?? '');
  let w = 0;
  for (const ch of str) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return str + ' '.repeat(Math.max(0, width - w));
}

export const HELP = `
MC Studio 功能转换器 —— 尽量把一个功能 / 效果搬到另一个版本或加载器

  convert rules                       列转换规则（含外部自动发现的）与加载诊断
  convert matrix                      任意两个目标之间有多少「有证据」的映射
  convert inspect <文件|工程>          抽出功能 IR，看它由哪些部件组成
  convert run     <文件|工程> --to ID  预览转换：分级报告 + 转换后代码（只读）
  convert apply   <工程> --to ID --yes  把结果写进工程（必须显式确认）

输入可以是：工程目录、.studio/project.json、分享包 .mcpkg.json、
            mcblocks.json、一段 .java 文本、或 mcstudio.feature IR。
通用参数：--to <目标ID>  --from <源目标ID>  --out <文件>  --json
`;

const STATUS_LABEL = { ported: '自动完成', adapted: '已改写', manual: '需人工', blocked: '做不到' };

function reportLines(r) {
  const s = r.summary;
  const lines = [
    `  ${r.from.id}  →  ${r.to.id}（${r.from.label} → ${r.to.label}）`,
    `  共 ${s.total} 项：${s.ported} 自动 / ${s.adapted} 已改写 / ${s.manual} 需人工 / ${s.blocked} 做不到`,
    `  自动率 ${s.autoRate}%   综合覆盖 ${s.coverage}%   需要复核 ${r.needsReview} 项`,
    '',
  ];
  for (const i of r.items) {
    lines.push(`  [${pad(STATUS_LABEL[i.status], 8)}] ${pad(i.label, 34)} ${i.rule}`);
    for (const n of i.notes.slice(0, 2)) lines.push(`      · ${n}`);
    if (i.suggestion) lines.push(`      → ${i.suggestion}`);
  }
  if (r.warnings.length) { lines.push('', '  警告：'); for (const w of r.warnings) lines.push(`    ! ${w}`); }
  if (r.limitations?.length) {
    lines.push('', '  本次能力边界（自动率只代表已采集的部件）：');
    for (const l of r.limitations) lines.push(`    · ${l}`);
  }
  if (r.needsReview) lines.push('', '  ⚠ 有需人工的项目：转换结果里已写 // TODO(转换)，编译前请按提示改完。');
  lines.push('', '  下一步：生成一次并构建，让目标适配器重出资源并验证 Java。');
  return lines;
}

export async function convertCommand(sub, argv = []) {
  const { positional, opts } = parseArgs(argv);
  const json = !!opts.json;
  switch (sub) {
    case 'help': case '': case undefined:
      return result(0, HELP.trim().split('\n'));

    case 'rules': {
      const data = { rules: listRules(), diagnostics: convertDiagnostics(), targets: listTargets() };
      if (json) return result(0, [], data);
      const lines = [`  已登记 ${data.rules.length} 条转换规则：`, ''];
      for (const r of data.rules) {
        lines.push(`  ${pad(r.id, 24)} ${pad(r.label, 22)} 优先级 ${String(r.priority).padStart(3)}  ${r.builtin ? '内置' : '外部'}`);
        if (r.description) lines.push(`      ${r.description}`);
      }
      lines.push('', '  放自定义规则：~/.mcstudio/convert/<名字>.mjs（导出 rule 对象）');
      lines.push('  或设 MCSTUDIO_CONVERT 指向目录；工程内 <工程>/.studio/convert/ 也认。');
      if (data.diagnostics.length) { lines.push('', '  诊断：'); for (const d of data.diagnostics) lines.push(`    ! ${d}`); }
      return result(0, lines, data);
    }

    case 'matrix': {
      const data = conversionMatrix();
      if (json) return result(0, [], data);
      const lines = [`  ${data.targets.length} 个目标 / ${data.pairs.length} 条转换方向 / ${data.rules} 条规则`, ''];
      for (const p of data.pairs) {
        lines.push(`  ${pad(p.from, 16)} → ${pad(p.to, 16)} ${p.crossLoader ? '跨加载器' : '同加载器'}  有证据模板 ${String(p.verifiedTemplates).padStart(2)}  符号组 ${p.symbolGroups}  ${p.verdict}`);
      }
      if (data.diagnostics.length) { lines.push('', '  诊断：'); for (const d of data.diagnostics) lines.push(`    ! ${d}`); }
      return result(0, lines, data);
    }

    case 'inspect': {
      const src = positional[0];
      if (!src) return fail('要给文件或工程目录：node studio.mjs convert inspect <路径>');
      let feature;
      try { feature = readFeature(src, { targetId: opts.from || '' }); } catch (e) { return fail(e.message); }
      const data = { feature, summary: featureSummary(feature), from: opts.from || feature.origin.targetId };
      if (json) return result(0, [], data);
      const s = data.summary;
      const lines = [`  ${s.name}（${s.kind}）· ${s.total} 个部件`, `  来源目标：${data.from || '未标注，转换时用 --from 指定'}`, ''];
      for (const p of s.parts) lines.push(`  ${pad(p.id, 30)} ${pad(p.kind, 10)} ${p.label}`);
      return result(0, lines, data);
    }

    case 'run': {
      const src = positional[0];
      if (!src) return fail('要给文件或工程目录：node studio.mjs convert run <路径> --to <目标ID>');
      if (!opts.to && !opts.targetId && !opts.target) return fail('要给 --to <目标ID>（可用 node studio.mjs targets 看清单）');
      const to = opts.to || opts.targetId || opts.target;
      let feature;
      try { feature = readFeature(src, { targetId: opts.from || '' }); } catch (e) { return fail(e.message); }
      const r = convert(feature, { targetId: String(to), fromTargetId: opts.from || undefined });
      if (!r.ok) return result(1, r.errors.map((e) => `  ✗ ${e}`), { ...r, error: r.errors.join('；') });
      if (opts.out) {
        const dest = path.resolve(String(opts.out));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const asJson = opts.format === 'json' || (opts.format !== 'java' && /\.json$/i.test(dest));
        fs.writeFileSync(dest, asJson ? JSON.stringify(r.result, null, 2) : convertedJava(r), 'utf8');
        r.out = dest;
      }
      if (json) return result(0, [], r);
      const lines = [...reportLines(r)];
      if (opts.out) lines.push(`  已写出：${path.resolve(String(opts.out))}`);
      else lines.push('', '  —— 转换后的 Java ——', ...convertedJava(r).split('\n').map((l) => '  ' + l));
      return result(0, lines, r);
    }

    case 'apply': {
      const src = positional[0];
      if (!src) return fail('要给工程目录：node studio.mjs convert apply <工程目录> --to <目标ID> --yes');
      if (!opts.to && !opts.targetId && !opts.target) return fail('要给 --to <目标ID>');
      if (!opts.yes && !opts.confirm) return fail('应用会改工程数据，请加 --yes 明确确认（先跑 convert run 预览）');
      const root = path.resolve(String(src));
      const to = String(opts.to || opts.targetId || opts.target);
      let r;
      try { r = convertProject(root, { targetId: to, fromTargetId: opts.from || undefined }); }
      catch (e) { return fail(e.message); }
      if (!r.ok) return result(1, r.errors.map((e) => `  ✗ ${e}`), { ...r, error: r.errors.join('；') });
      let applied;
      try { applied = applyConversion(root, r, { confirmed: true }); }
      catch (e) { return fail(e.message); }
      if (opts.generate) {
        const { generate } = await import('../generator/pipeline.mjs');
        applied.generate = await generate(root, { force: !!opts.force });
      }
      const data = { ...applied, report: r };
      if (json) return result(0, [], data);
      const lines = [
        `  ✓ 已把 ${applied.from || '(未标注)'} 的工程切到 ${applied.to}`,
        `  ${applied.hooks} 段 Java / ${applied.programs} 段积木程序 / ${applied.changedParts.length} 个部件被改写`,
        `  需人工复核 ${r.needsReview} 项（代码里已标 // TODO(转换)）`,
        `  已备份原工程数据：${applied.backup}`,
        `  ${applied.next}`,
      ];
      if (applied.generate) lines.push(`  已重新生成：写入 ${applied.generate.written.length} / 冲突 ${applied.generate.conflicts.length}`);
      return result(0, lines, data);
    }

    default:
      return fail(`未知子命令 "${sub}"。跑 node studio.mjs convert help 看用法。`);
  }
}
