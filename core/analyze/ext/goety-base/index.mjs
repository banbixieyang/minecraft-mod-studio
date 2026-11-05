/**
 * Goety 基础库（modId = goety）分析扩展。
 *
 * 附属包（goety_revelation）只是内容与饰品，真正的「效果」全在基础库里：
 *  · 92 个状态效果（MobEffect 子类）
 *  · 125 个法术（11 个学派）
 *  · 7 个附魔
 *  · 40+ 酿造效果
 *  · 6 个配置类、1600+ 个可调数值（SpellConfig / AttributesConfig / BrewConfig …）
 *
 * 关键点：Goety 的数值不在代码里写死，而是走 Forge 配置（config/goety-*.toml），
 * 默认值定义在 com.Polarice3.Goety.config.* 的 <clinit> 里，形如
 *   BUILDER.comment("…Default: 18").defineInRange("vexCost", 18, 0, 2147483647)
 * 所以只要把 <clinit> 的字节码常量按「说明 / 路径 / 默认值 / 最小 / 最大」配对出来，
 * 就得到一张完整、可改、带取值范围的数值表 —— 也就是「各种效果」的真正数值所在。
 */
import { parseClass } from '../../classfile.mjs';
import {
  readClass, safeId, extractConfigEntries,
  extractConfigFiles, extractConfigClassFiles,
} from '../../forge/config.mjs';
import { buildToml, buildJava, buildReadme } from '../../forge/override.mjs';

const BASE_PKG = 'com/Polarice3/Goety/';
const CLASS_PKG = 'com/Polarice3/Goety/common/magic/spells/';
const CONFIG_PKG = 'com/Polarice3/Goety/config/';
const EFFECT_PKG = 'com/Polarice3/Goety/common/effects/';

/** 配置路径的命名风格：lowerCamelCase 标识符 */
const PATH_RE = /^[a-z][A-Za-z0-9]*$/;

/** 学派枚举 → 语言文件里的键 */
const SPELL_TYPE_KEYS = {
  NONE: 'none', NECROMANCY: 'necromancy', NETHER: 'nether', ILL: 'ill',
  FROST: 'frost', GEOMANCY: 'geomancy', WIND: 'wind', STORM: 'storm',
  ABYSS: 'abyss', WILD: 'wild', VOID: 'void',
};

const camelToSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const snakeToCamel = (s) => s.split(/[_\s]+/).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** 从一个类的方法里找它引用的配置字段名，比如 SpellConfig.MagicBoltCost → 'MagicBoltCost' */
function configRefOf(cls, methodName) {
  if (!cls) return null;
  const m = cls.methods.find((x) => x.name === methodName);
  if (!m || !m.consts || !m.consts.fieldRefs) return null;
  const ref = m.consts.fieldRefs.find((r) => r.static && r.cls.includes('/config/'));
  return ref ? { cls: ref.cls.split('/').pop(), name: ref.name } : null;
}

/** 类里自己写的浮点/整数常量（不含继承来的），作为「这个效果自己的数值」 */
function ownNumbers(cls) {
  if (!cls) return [];
  const out = [];
  for (const m of cls.methods) {
    if (!m.consts || !m.consts.numbers) continue;
    for (const n of m.consts.numbers) {
      if (typeof n === 'number' && Number.isFinite(n)) out.push(n);
    }
  }
  return [...new Set(out)];
}

export default {
  id: 'goety-base',
  name: 'Goety 基础库扩展',
  order: 5,
  match: (meta) => !!(meta && meta.id === 'goety'),

  contentTypes: {
    statusEffect: { label: '状态效果', icon: '☠' },
    spell: { label: '法术', icon: '✦' },
    spellConfig: { label: '数值配置', icon: '⚙' },
    brewEffect: { label: '酿造效果', icon: '🧪' },
    enchantment: { label: '附魔', icon: '🔮' },
  },

  fields: {
    statusEffect: [
      { key: 'nameZh', label: '名称(中)', kind: 'text' },
      { key: 'descriptionZh', label: '效果说明(中)', kind: 'text' },
    ],
    spell: [
      { key: 'nameZh', label: '名称(中)', kind: 'text' },
      { key: 'soulCost', label: '灵魂消耗', kind: 'int', min: 0, max: 9999 },
      { key: 'castDuration', label: '吟唱时长(tick)', kind: 'int', min: 0, max: 99999 },
      { key: 'cooldown', label: '冷却(tick)', kind: 'int', min: 0, max: 999999 },
      { key: 'damage', label: '伤害', kind: 'num', min: 0, max: 9999 },
    ],
    spellConfig: [
      { key: 'value', label: '数值', kind: 'num' },
      { key: 'min', label: '最小值', kind: 'num' },
      { key: 'max', label: '最大值', kind: 'num' },
    ],
    brewEffect: [
      { key: 'nameZh', label: '名称(中)', kind: 'text' },
    ],
    enchantment: [
      { key: 'nameZh', label: '名称(中)', kind: 'text' },
      { key: 'descriptionZh', label: '说明(中)', kind: 'text' },
    ],
  },

  analyze(ctx) {
    const { src, lang } = ctx;
    const zh = (lang && lang.zh_cn) || {};
    const en = (lang && lang.en_us) || {};
    const warnings = [];
    const out = { statusEffect: [], spell: [], spellConfig: [], brewEffect: [], enchantment: [] };

    const names = src.allNames || [];

    // ---------- 1. 数值配置：所有 config 类的 <clinit> ----------
    const configClasses = names
      .filter((n) => n.startsWith(CONFIG_PKG) && n.endsWith('.class') && !n.includes('$'))
      .filter((n) => n.split('/').pop().replace('.class', '').endsWith('Config'));
    const configByField = new Map(); // "SpellConfig.MagicBoltCost" → 配置项
    const classFiles = extractConfigClassFiles(src, `${BASE_PKG}Goety.class`); // 配置类名 → { file, dir }
    const usedIds = new Set();
    for (const cp of configClasses) {
      const entries = extractConfigEntries(src, cp);
      const simple = cp.split('/').pop().replace('.class', '');
      const fileInfo = classFiles.get(simple) || null;
      for (const e of entries) {
        const rawPath = e.id;                       // 原本是配置路径（toml 里的键）
        let id = safeId(`${e.group}_${rawPath}`);
        if (usedIds.has(id)) id = safeId(`${id}_${e.field}`); // Goety 自己也撞过同名路径
        let n = 2;
        while (usedIds.has(id)) id = safeId(`${id}_${n++}`);
        usedIds.add(id);
        e.id = id;          // 包内标识（合法字符、唯一）
        e.path = rawPath;   // 真实配置路径（toml 里的键名）
        e.configClass = simple;
        e.configFile = fileInfo ? fileInfo.file : '';   // goety-spells.toml
        e.configDir = fileInfo ? fileInfo.dir : '';     // goety/
        e.tomlPath = fileInfo ? [...e.sections, rawPath].join('.') : ''; // Spells.Vexing Spell.vexCost
        out.spellConfig.push(e);
        configByField.set(`${e.group}.${e.field}`, e);
      }
    }
    if (!out.spellConfig.length) {
      warnings.push('Goety 扩展：没从 config 类里读到数值配置（可能这版改了配置写法）');
    }

    // ---------- 2. 状态效果 ----------
    const effectClasses = names
      .filter((n) => n.startsWith(EFFECT_PKG) && n.endsWith('.class') && !n.includes('/brew/') && !n.includes('$'))
      .map((n) => ({ path: n, simple: n.split('/').pop().replace('.class', '') }));
    const effectByKey = new Map();
    for (const ec of effectClasses) {
      const key = camelToSnake(ec.simple.replace(/Effect$/, ''));
      effectByKey.set(key, ec.path);
    }
    // 语言文件里的 effect.goety.<id>（含 .description 之外还有属性修饰符后缀）
    const effectIds = new Set();
    for (const key of Object.keys(zh)) {
      const m = /^effect\.goety\.([a-z0-9_]+)(?:\.description)?$/.exec(key);
      if (m) effectIds.add(m[1]);
    }
    for (const key of Object.keys(en)) {
      const m = /^effect\.goety\.([a-z0-9_]+)(?:\.description)?$/.exec(key);
      if (m) effectIds.add(m[1]);
    }
    for (const id of [...effectIds].sort()) {
      const clsPath = effectByKey.get(id);
      const cls = clsPath ? readClass(src, clsPath) : null;
      // 属性修饰符：effect.goety.<id>.<attribute>
      const attrs = [];
      for (const key of Object.keys(zh)) {
        const m = new RegExp(`^effect\\.goety\\.${id}\\.([a-z_]+)$`).exec(key);
        if (m && m[1] !== 'description') attrs.push(m[1]);
      }
      out.statusEffect.push({
        id: `goety_${id}`,
        registryId: `goety:${id}`,
        nameZh: zh[`effect.goety.${id}`] || '',
        nameEn: en[`effect.goety.${id}`] || '',
        descriptionZh: zh[`effect.goety.${id}.description`] || '',
        descriptionEn: en[`effect.goety.${id}.description`] || '',
        class: clsPath ? clsPath.split('/').pop() : '',
        attributes: attrs,
        numbers: ownNumbers(cls).slice(0, 12),
      });
    }

    // ---------- 3. 法术 ----------
    const spellClasses = names
      .filter((n) => n.startsWith(CLASS_PKG) && n.endsWith('Spell.class') && !n.includes('$'))
      .filter((n) => !/\/(necromancy|nether|frost|geomancy|abyss|storm|utility|void_spells|wild|wind)\//.test(n) || true);
    for (const sp of spellClasses) {
      const rel = sp.slice(CLASS_PKG.length); // 如 "nether/FireballSpell.class"
      const simple = sp.split('/').pop().replace('.class', '');
      const base = simple.replace(/Spell$/, '');
      const snake = camelToSnake(base);
      const cls = readClass(src, sp);

      // 学派：getSpellType() 里 getstatic SpellType.XXX
      let school = '';
      const typeM = cls && cls.methods.find((m) => m.name === 'getSpellType');
      if (typeM && typeM.consts && typeM.consts.fieldRefs) {
        const ref = typeM.consts.fieldRefs.find((r) => r.cls.includes('magic/SpellType'));
        if (ref) school = (SPELL_TYPE_KEYS[ref.name] || ref.name.toLowerCase());
      }
      // getSpellType 只在部分类里定义，退回用目录名
      if (!school) {
        const dir = rel.includes('/') ? rel.split('/')[0] : '';
        school = dir === 'void_spells' ? 'void' : dir || 'none';
      }

      // 数值：从 SpellConfig 里按字段名查
      const costRef = configRefOf(cls, 'defaultSoulCost');
      const durRef = configRefOf(cls, 'defaultCastDuration');
      const cdRef = configRefOf(cls, 'defaultSpellCooldown');
      const costEntry = costRef ? configByField.get(`${costRef.cls}.${costRef.name}`) : null;
      const durEntry = durRef ? configByField.get(`${durRef.cls}.${durRef.name}`) : null;
      const cdEntry = cdRef ? configByField.get(`${cdRef.cls}.${cdRef.name}`) : null;

      // 伤害：配置表里可能有 <Spell>Damage / <Spell>MinDamage / <Spell>MaxDamage / <Spell>Power
      // 配置路径是 lowerCamelCase（magicBoltDamage），字段名是 upperCamelCase（MagicBoltDamage）
      const cfgPrefix = lowerFirst(base);
      const dmgKeys = [`${cfgPrefix}Damage`, `${cfgPrefix}MinDamage`, `${cfgPrefix}MaxDamage`, `${cfgPrefix}Power`];
      let damage = null;
      for (const k of dmgKeys) {
        const e = configByField.get(`SpellConfig.${upperFirst(k)}`);
        if (e && typeof e.value === 'number') { damage = e.value; break; }
      }

      const focusKey = `item.goety.${snake}_focus`;
      out.spell.push({
        id: snake,
        nameZh: zh[focusKey] || zh[`spell.goety.${snake}`] || '',
        nameEn: en[focusKey] || en[`spell.goety.${snake}`] || '',
        descriptionZh: zh[`${focusKey}.info`] || '',
        descriptionEn: en[`${focusKey}.info`] || '',
        school,
        schoolZh: (zh[`spell.goety.${school}`] || '').replace(/§./g, ''),
        class: simple,
        soulCost: costEntry ? Number(costEntry.value) : null,
        castDuration: durEntry ? Number(durEntry.value) : null,
        cooldown: cdEntry ? Number(cdEntry.value) : null,
        damage,
        configRefs: [costRef, durRef, cdRef].filter(Boolean).map((r) => `${r.cls}.${r.name}`),
      });
    }

    // ---------- 4. 酿造效果 ----------
    const brewClasses = names
      .filter((n) => n.startsWith(`${EFFECT_PKG}brew/`) && n.endsWith('.class') && !n.includes('/block/') && !n.includes('/modifiers/') && !n.includes('$'));
    for (const bp of brewClasses) {
      const simple = bp.split('/').pop().replace('.class', '');
      const key = camelToSnake(simple.replace(/BrewEffect$/, '').replace(/Effect$/, ''));
      if (!key || key === 'brew') continue; // 抽象基类不是一条真实效果
      const cls = readClass(src, bp);
      out.brewEffect.push({
        id: key,
        nameZh: zh[`effect.goety.${key}`] || zh[`effect.goety.${key}_brew`] || '',
        nameEn: en[`effect.goety.${key}`] || '',
        class: simple,
        numbers: ownNumbers(cls).slice(0, 10),
      });
    }

    // ---------- 5. 附魔 ----------
    const encIds = new Set();
    for (const key of Object.keys(zh)) {
      const m = /^enchantment\.goety\.([a-z0-9_]+)(?:\.desc)?$/.exec(key);
      if (m) encIds.add(m[1]);
    }
    for (const key of Object.keys(en)) {
      const m = /^enchantment\.goety\.([a-z0-9_]+)(?:\.desc)?$/.exec(key);
      if (m) encIds.add(m[1]);
    }
    for (const id of [...encIds].sort()) {
      const clsPath = `${BASE_PKG}common/enchantments/${snakeToCamel(id)}Enchantment.class`;
      const cls = readClass(src, clsPath);
      out.enchantment.push({
        id,
        nameZh: zh[`enchantment.goety.${id}`] || '',
        nameEn: en[`enchantment.goety.${id}`] || '',
        descriptionZh: zh[`enchantment.goety.${id}.desc`] || '',
        descriptionEn: en[`enchantment.goety.${id}.desc`] || '',
        class: cls ? clsPath.split('/').pop() : '',
        numbers: ownNumbers(cls).slice(0, 10),
      });
    }

    warnings.push(
      `Goety 扩展：状态效果 ${out.statusEffect.length}、法术 ${out.spell.length}、` +
      `数值配置 ${out.spellConfig.length}、酿造效果 ${out.brewEffect.length}、附魔 ${out.enchantment.length}`
    );

    return { contents: out, warnings };
  },

  /**
   * 导出钩子：把「改过的数值」变成真正能生效的东西。
   *
   * 光把 spellConfig 条目打进包没用 —— 那些数值在 Goety 的 Forge 配置里，
   * 不落到 toml 文件或运行时代码就等于没改。
   *
   * 这里做两件事：
   *   1. 生成 TOML 覆写文件（放进游戏的 config/goety/ 目录即生效）
   *   2. 生成 Java 覆写代码（改运行中的内存值，立刻见效）
   *
   * 判定「改过」的方式：把 overrides 里的值和条目原值比。
   * 没改的条目不进覆写文件 —— 免得把 1500 条默认值全写一遍，
   * 那样用户改一个数值却要接受整个文件被覆盖。
   */
  onExport(ctx) {
    const { report, overrides = {}, pack } = ctx || {};
    const edits = overrides.spellConfig || {};
    if (!Object.keys(edits).length) return { files: [], java: [], warnings: [] };

    const all = (report?.contents?.spellConfig || []);
    const changed = [];
    for (const e of all) {
      const ov = edits[e.id];
      if (!ov || typeof ov !== 'object') continue;
      if (!('value' in ov)) continue;
      const nv = Number(ov.value);
      if (!Number.isFinite(nv)) continue;
      if (nv === Number(e.value)) continue; // 没真改
      changed.push({ ...e, originalValue: e.value, value: nv });
    }
    if (!changed.length) return { files: [], java: [], warnings: [] };

    const files = [];
    const warnings = [];

    // ---- 1. TOML 覆写：按配置文件分组，一个文件对应一个 toml ----
    const byFile = new Map();
    for (const e of changed) {
      const f = e.configFile || 'goety.toml';
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(e);
    }
    for (const [file, list] of byFile) {
      const dir = list[0].configDir || 'goety';
      const rel = `config/${dir}/${file}`;
      files.push({
        path: rel,
        content: buildToml(list, { header: `Goety 数值覆写 · ${file}（由 MC Studio 生成）` }),
        createOnly: false,
      });
    }

    // ---- 2. Java 覆写代码 ----
    // 放到 src/main/java 下，工程生成时才会被编译进 jar。
    // 包名用工程自己的（opts.projectPkg），否则包名对不上，编译不过。
    const pkg = ctx?.projectPkg || 'com.example.mod';
    const javaCode = buildJava(changed, {
      modId: report?.meta?.id || 'goety',
      projectModId: optsProjectModId(ctx),
      pkg,
    });
    files.push({
      path: `src/main/java/${pkg.replace(/\./g, '/')}/config/GoetyConfigOverrides.java`,
      content: javaCode,
      createOnly: false,
    });

    // ---- 3. 说明文档 ----
    files.push({
      path: 'goety-config-overrides/README.md',
      content: buildReadme(changed, { source: report?.meta?.name || 'Goety 基础库' }),
      createOnly: false,
    });

    warnings.push(
      `Goety 扩展：${changed.length} 项数值改动已生成覆写产物` +
      `（${byFile.size} 个 toml + 1 份 Java 代码）`
    );

    return { files, java: [], warnings };
  },
};

/** 工程自己的 modId（用于 Java 覆写类的 @Mod.EventBusSubscriber） */
function optsProjectModId(ctx) {
  return ctx?.projectModId || 'examplemod';
}
