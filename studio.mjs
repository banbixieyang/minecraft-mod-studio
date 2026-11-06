#!/usr/bin/env node
/**
 * MC Studio 命令行入口。
 *
 *   mcstudio start              启动可视化编辑器（本地服务 + 浏览器）
 *   mcstudio new <名字>          命令行新建工程
 *   mcstudio generate <目录>     只跑生成，不开界面
 *   mcstudio build <目录>        跑构建出 jar
 *   mcstudio modules            看装了哪些模块
 *   mcstudio blocks <子命令>     积木工具箱（列 / 编译 / 造库 / 体检 / 装库）
 *   mcstudio convert <子命令>    功能转换器（跨版本 / 跨加载器）
 *   mcstudio tools              列出 tools/ 里的脚本与用途
 *
 * 界面只是壳，所有能力这里都能直接调 —— 方便接 CI 或脚本化。
 * 所有命令都支持 --json，输出结构化结果给脚本解析。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0] || 'start';

function opt(name, dflt = null) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return dflt;
}
function flag(name) {
  return args.includes(`--${name}`);
}

const PROJECTS = path.join(HERE, 'projects');

function help() {
  console.log(`
MC Studio —— Minecraft 模组可视化编辑器

  node studio.mjs start [--port 4173] [--no-open]
  node studio.mjs new <名字> [--id modid] [--pkg com.example.modid] [--target fabric-26.3]
  node studio.mjs generate <工程目录> [--force]
  node studio.mjs build <工程目录> [--deploy 客户端mods目录]
  node studio.mjs modules
  node studio.mjs targets
  node studio.mjs blocks help      积木工具箱（列 / 编译 / 造库 / 体检 / 装库）
  node studio.mjs convert help     功能转换器（跨版本 / 跨加载器搬功能）
  node studio.mjs tools            tools/ 脚本索引

所有命令都支持 --json。
`);
}

async function main() {
  switch (cmd) {
    case 'start': {
      const { start } = await import('./core/serve/server.mjs');
      const port = Number(opt('port', 4173));
      const { url } = await start(port);
      console.log(`\n  MC Studio 已启动：${url}`);
      console.log(`  工程目录：${PROJECTS}\n`);
      if (!flag('no-open')) openBrowser(url);
      // 保持进程活着
      await new Promise(() => {});
      break;
    }

    case 'new': {
      const name = args[1] && !args[1].startsWith('--') ? args[1] : '我的模组';
      const P = await import('./core/project.mjs');
      const { generate } = await import('./core/generator/pipeline.mjs');
      const { getTarget } = await import('./core/target/registry.mjs');
      const targetId = opt('target', 'fabric-26.3');
      const t = getTarget(targetId);
      const id = opt('id', slugify(name));
      const dir = path.join(PROJECTS, id);
      if (fs.existsSync(dir)) {
        console.error(`  已存在工程目录：${dir}`);
        process.exit(1);
      }
      P.createProject(dir, {
        name,
        id,
        pkg: opt('pkg', `com.example.${id}`),
        version: opt('version', '0.1.0'),
        target: { ...t.defaults, id: t.id },
      });
      const report = await generate(dir, { clientModsDir: opt('deploy', '') });
      console.log(`  工程已创建：${dir}`);
      console.log(`  生成 ${report.written.length} 个文件，跳过 ${report.skipped.length}，冲突 ${report.conflicts.length}`);
      if (report.errors.length) report.errors.forEach((e) => console.error('  ! ' + e));
      break;
    }

    case 'generate': {
      const dir = args[1];
      if (!dir) return help();
      const { generate } = await import('./core/generator/pipeline.mjs');
      const report = await generate(path.resolve(dir), { force: flag('force') });
      console.log(`写入 ${report.written.length} / 未变 ${report.unchanged.length} / 冲突 ${report.conflicts.length} / 删除 ${report.removed.length}`);
      for (const c of report.conflicts) console.log(`  ！冲突 ${c.path}：${c.reason}`);
      for (const e of report.errors) console.log(`  ! ${e}`);
      for (const w of report.warnings) console.log(`  · ${w}`);
      break;
    }

    case 'build': {
      const dir = args[1];
      if (!dir) return help();
      const root = path.resolve(dir);
      const { runGradle, findArtifacts, extractErrors } = await import('./core/build/gradle.mjs');
      const task = flag('deploy') ? 'build' : 'build';
      const job = runGradle(root, task);
      const timer = setInterval(() => {
        // 边跑边刷最后一行，命令行里能看出没卡住
        const last = job.lines[job.lines.length - 1];
        if (last) process.stdout.write(`\r  ${last.slice(0, 100).padEnd(100)}`);
      }, 300);
      await new Promise((res) => {
        const check = setInterval(() => {
          if (!job.running) {
            clearInterval(check);
            res();
          }
        }, 300);
      });
      clearInterval(timer);
      const errs = extractErrors(job);
      if (job.exitCode === 0) {
        console.log('\n  构建成功');
        for (const a of findArtifacts(root)) console.log(`  产物：${a.path}  (${(a.size / 1024).toFixed(0)} KB)`);
        if (opt('deploy')) {
          const dest = path.resolve(opt('deploy'));
          fs.mkdirSync(dest, { recursive: true });
          for (const a of findArtifacts(root)) {
            fs.copyFileSync(a.path, path.join(dest, a.name));
            console.log(`  已部署：${path.join(dest, a.name)}`);
          }
        }
      } else {
        console.error(`\n  构建失败（退出码 ${job.exitCode}）${job.error ? '：' + job.error : ''}`);
        errs.slice(0, 20).forEach((e) => console.error('  ' + e));
        for (const l of job.lines.slice(-8)) console.error('  ' + l);
        process.exitCode = 1;
      }
      break;
    }

    case 'modules': {
      const { listModules, listContentTypes } = await import('./core/modules/registry.mjs');
      const mods = listModules();
      console.log(`\n  已加载 ${mods.length} 个模块：\n`);
      for (const m of mods) {
        console.log(`  ${m.name.padEnd(12)} ${m.id.padEnd(18)} ${(m.__scope === 'builtin' ? '内置' : '工程私有').padEnd(6)} ${m.description || ''}`);
        for (const t of m.contentTypes || []) console.log(`      - ${t.label}  (${t.id})`);
      }
      console.log('');
      break;
    }

    case 'targets': {
      const { listTargets } = await import('./core/target/registry.mjs');
      console.log('');
      for (const t of listTargets()) {
        console.log(`  ${t.id.padEnd(16)} ${t.label.padEnd(16)} JDK ${t.javaVersion}  ${t.experimental ? '(实验性)' : ''}`);
      }
      console.log('');
      break;
    }

    case 'blocks': {
      const { blocksCommand } = await import('./core/cli/blocks.mjs');
      const r = await blocksCommand(args[1], args.slice(2));
      // --json 给 CI 用：只吐结构化结果，不掺人话
      if (flag('json') && r.data !== null && r.data !== undefined) {
        console.log(JSON.stringify(r.data, null, 2));
      } else {
        for (const line of r.lines) console.log(line);
      }
      if (r.exitCode) process.exitCode = r.exitCode;
      break;
    }

    case 'convert': {
      const { convertCommand } = await import('./core/cli/convert.mjs');
      const r = await convertCommand(args[1], args.slice(2));
      if (flag('json') && r.data !== null && r.data !== undefined) {
        console.log(JSON.stringify(r.data, null, 2));
      } else {
        for (const line of r.lines) console.log(line);
      }
      if (r.exitCode) process.exitCode = r.exitCode;
      break;
    }

    case 'tools': {
      const { toolsCommand } = await import('./core/cli/tools.mjs');
      const r = toolsCommand(args.slice(1));
      if (flag('json') && r.data) console.log(JSON.stringify(r.data, null, 2));
      else for (const line of r.lines) console.log(line);
      break;
    }

    default:
      help();
  }
}

function slugify(s) {
  const ascii = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ascii || 'mymod';
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* 打不开就让用户自己点链接 */
  }
}

main().catch((e) => {
  console.error(`\n  出错了：${e.message}\n`);
  process.exit(1);
});
