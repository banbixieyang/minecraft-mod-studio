/**
 * Goety Delight 分析扩展（modId = goetydelight）。
 *
 * Goety Delight 是 Goety 生态的「食物 + 仪式」附属包，本身不含法术体系，
 * 但它自带一套完整的「效果」：
 *  · 14 个自定义状态效果（buff/effect/impl/ 下的 MobEffect 子类）
 *  · 5 个自定义附魔（enchantments/）
 *  · 40+ 条自定义配方（goety:brewing / goety:ritual / farmersdelight:cooking 等）
 *  · 一份 Forge 配置（goetydelight-common.toml），里面是效果半径、
 *    持续时间倍率、叠加层数这类真正决定「效果有多强」的数值
 *
 * 核心引擎只认原版那套（物品/方块/原版配方），这些都会整批跳过。
 * 这个扩展把它们都补回来，并让它们能在拆解台里单独查看、改数值、导出。
 */
import { readJson } from '../../sources.mjs';
import {
  readClass, safeId,
  extractConfigEntries, extractConfigClassFiles,
} from '../../forge/config.mjs';
import { buildToml, buildJava, buildReadme } from '../../forge/override.mjs';

const PKG = 'net/v_black_cat/goetydelight/';
const MAIN_CLASS = `${PKG}GoetyDelight.class`;
const CONFIG_PKG = `${PKG}config/`;
const EFFECT_PKG = `${PKG}effect/`;
const BUFF_PKG = `${PKG}buff/effect/impl/`;
const ENCHANT_PKG = `${PKG}enchantments/`;

const camelToSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/**
 * 没有本地化名字时，从类名 / 注册表 id 派一个人类可读的名字。
 *
 * 有些 mod 作者漏写了语言条目（上游确实存在这种缺口），
 * 界面上留空会让条目认不出来 —— 派一个「类名拆词」的英文名，
 * 并用 nameDerived 标明它是推出来的，不是官方翻译（不伪造中文）。
 */
function deriveName(id, classSimple) {
  const base = (classSimple || id || '')
    .replace(/(Effect|Enchantment|Buff)$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return base
    ? base.split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
    : '';
}

/** 核心引擎已支持的配方类型 */
const CORE_RECIPE_TYPES = new Set([
  'crafting_shaped', 'crafting_shapeless',
  'smelting', 'blasting', 'smoking', 'campfire_cooking', 'stonecutting',
  'smithing_transform', 'smithing_trim',
]);

function pickId(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const x of v) { const r = pickId(x); if (r) return r; }
    return '';
  }
  if (typeof v === 'object') {
    if (v.item) return pickId(v.item);
    if (v.id) return pickId(v.id);
    if (v.tag) return `#${v.tag}`;
  }
  return '';
}

/**
 * 收集配方文件，按 id 去重。
 *
 * Goety Delight 只用复数目录 recipes/，但同名配方可能出现在不同子目录
 * （cooking/ectoplasmic_melon 和 cutting/ectoplasmic_melon 是两个不同的配方），
 * 所以 id 要带目录前缀，跟核心引擎的处理一致。
 */
function listRecipeFiles(src, ns) {
  const byId = new Map();
  for (const dir of [`data/${ns}/recipe`, `data/${ns}/recipes`]) {
    let names = [];
    try { names = src.list(dir); } catch { continue; }
    for (const p of names) {
      if (!/\.json$/i.test(p)) continue;
      // 目录边界要卡死：list('data/ns/recipe') 会连 'recipes/…' 一起捞进来
      const rest = p.slice(dir.length);
      if (rest && !rest.startsWith('/')) continue;
      const rel = rest.slice(1);
      if (!rel) continue;
      const id = rel.replace(/\.json$/i, '').replace(/\//g, '_');
      if (!byId.has(id)) byId.set(id, { id, path: p, rel });
    }
  }
  return [...byId.values()];
}

/** 从一个类的方法里找它引用的配置字段名，比如 Config.CAKE_EFFECT_RADIUS */
function configRefOf(cls, methodName) {
  if (!cls) return null;
  const m = cls.methods.find((x) => x.name === methodName);
  if (!m || !m.consts || !m.consts.fieldRefs) return null;
  const ref = m.consts.fieldRefs.find((r) => r.static && r.cls.includes('/config/'));
  return ref ? { cls: ref.cls.split('/').pop(), name: ref.name } : null;
}

/** 类里自己写的数值常量，作为「这个效果自己的数值」 */
function ownNumbers(cls, limit = 12) {
  if (!cls) return [];
  const out = [];
  for (const m of cls.methods) {
    if (!m.consts || !m.consts.numbers) continue;
    for (const n of m.consts.numbers) {
      if (n && typeof n.value === 'number') out.push(n.value);
    }
    if (out.length >= limit * 3) break;
  }
  return out.slice(0, limit);
}

/**
 * 找附魔的最大等级。
 *
 * 附魔的 getMaxLevel() 在重映射过的包里名字不可读（m_6586_ 这种），
 * 但特征很稳：无参、返回 int、返回一个小的常量。
 * 所以按「无参 + 返回整数 + 值在 1..99」来找，而不是认名字。
 */
function maxLevelOf(cls) {
  if (!cls) return 1;
  for (const m of cls.methods || []) {
    if (m.desc !== '()I') continue;
    const r = m.consts?.returns || [];
    if (r.length !== 1) continue;
    const v = r[0];
    if (Number.isInteger(v) && v >= 1 && v <= 99) return v;
  }
  return 1;
}

/**
 * 找状态效果的持续时间与等级。
 *
 * MobEffect 的构造参数是 (int color) 或 (int color, int category)，
 * 重映射后类里只剩常量。这里取「构造器里出现的最大整数」当颜色，
 * 持续时间和等级在 mod 里多半走配置，不在 class 里 —— 留空比瞎猜好。
 */
function effectNumbersOf(cls) {
  if (!cls) return { duration: null, amplifier: null };
  const ctor = (cls.methods || []).find((m) => m.name === '<init>');
  const nums = (ctor?.consts?.numbers || []).map((n) => n.value).filter((v) => typeof v === 'number');
  return { duration: null, amplifier: null, color: nums.length ? nums[nums.length - 1] : null };
}

export default {
  id: 'goety-delight',
  name: 'Goety Delight 扩展',
  order: 15,
  match: (meta) => !!(meta && meta.id === 'goetydelight'),

  contentTypes: {
    delightConfig: { label: '数值配置', icon: '⚙' },
    delightEffect: { label: '状态效果', icon: '☠' },
    delightEnchant: { label: '附魔', icon: '🔮' },
    delightRecipe: { label: '仪式/料理配方', icon: '⚗' },
  },

  // 这些配方类型核心引擎不认，但本扩展收走了 —— 核心就不该再报「已跳过」
  handlesRecipeTypes: [
    'goety:brewing', 'goety:ritual', 'goety:brazier',
    'farmersdelight:cooking', 'farmersdelight:cutting',
    'goetydelight:',
  ],

  // 拆解台里这些类型可编辑的字段（kind 与内置类型一致：text|int|num|bool）
  fields: {
    delightConfig: [
      { key: 'value', label: '数值', kind: 'num' },
      { key: 'min', label: '最小值', kind: 'num' },
      { key: 'max', label: '最大值', kind: 'num' },
    ],
    delightEffect: [
      { key: 'nameZh', label: '名称(中)', kind: 'text' },
      { key: 'duration', label: '持续时间(tick)', kind: 'int', min: 0, max: 1000000 },
      { key: 'amplifier', label: '效果等级', kind: 'int', min: 0, max: 255 },
    ],
    delightEnchant: [
      { key: 'nameZh', label: '名称(中)', kind: 'text' },
      { key: 'maxLevel', label: '最大等级', kind: 'int', min: 1, max: 255 },
    ],
    delightRecipe: [
      { key: 'type', label: '类型', kind: 'text' },
      { key: 'result', label: '产物', kind: 'text' },
      { key: 'count', label: '数量', kind: 'int', min: 1, max: 64 },
    ],
  },

  analyze(ctx) {
    const { src, mainNs, lang, contents } = ctx;
    const zh = (lang && lang.zh_cn) || {};
    const en = (lang && lang.en_us) || {};
    const warnings = [];
    const names = src.allNames || [];

    // ---------- 1. Forge 数值配置 ----------
    const classFiles = extractConfigClassFiles(src, MAIN_CLASS);
    const out = { delightConfig: [], delightEffect: [], delightEnchant: [], delightRecipe: [] };
    const usedIds = new Set();
    const configClasses = names
      .filter((n) => n.startsWith(CONFIG_PKG) && n.endsWith('.class') && !n.includes('$'))
      .filter((n) => n.split('/').pop().replace('.class', '').endsWith('Config'));

    for (const cp of configClasses) {
      const simple = cp.split('/').pop().replace('.class', '');
      const entries = extractConfigEntries(src, cp);
      const fileInfo = classFiles.get(simple) || null;
      for (const e of entries) {
        const rawPath = e.id;
        let id = safeId(`${e.group}_${rawPath}`);
        if (usedIds.has(id)) id = safeId(`${id}_${e.field}`);
        let n = 2;
        while (usedIds.has(id)) id = safeId(`${id}_${n++}`);
        usedIds.add(id);
        out.delightConfig.push({
          id,
          registryId: `${mainNs}:${rawPath}`,
          configClass: simple,
          configFile: fileInfo ? fileInfo.file : '',
          configDir: fileInfo ? fileInfo.dir : '',
          tomlPath: fileInfo ? [...e.sections, rawPath].join('.') : '',
          sections: e.sections,
          field: e.field,
          comment: e.comment,
          value: e.value,
          min: e.min,
          max: e.max,
        });
      }
    }
    if (!out.delightConfig.length) {
      warnings.push('Goety Delight 扩展：没在配置类里找到数值条目（可能版本换了写法）');
    }

    // ---------- 2. 自定义状态效果 ----------
    // 注册了的效果在 effect/ 目录（MobEffect 子类），
    // buff/effect/impl/ 里的是食物用的内部 buff 实现，不是独立效果，排除。
    const effectClasses = names
      .filter((n) => n.startsWith(EFFECT_PKG) && n.endsWith('.class') && !n.includes('$'))
      .filter((n) => !n.startsWith(BUFF_PKG))
      .map((n) => ({ path: n, simple: n.split('/').pop().replace('.class', '') }));

    // ModEffects 是注册器（持有所有效果的静态字段），不是效果本身
    const effectClassList = effectClasses.filter((ec) => {
      if (/^Mod/.test(ec.simple)) return false;
      // 必须是 MobEffect 的子类才算「效果」——
      // 同一个目录里还有 SpellCastEventHandler 这种事件处理器，不是效果。
      const cls = readClass(src, ec.path);
      return !!cls && /MobEffect/.test(cls.superName || '');
    });

    // ModEffects 里 register("warden") 的字符串才是真正的注册表 id。
    //
    // 字节码顺序：get EFFECTS → str "id" → call register → put FIELD
    // （register 的返回值才被 put 到字段里），所以字段名在 register **之后**。
    // 不能靠字段名反推 id —— 作者自己会拼错（比如 THE_PALE_MESSRNGER）。
    const effectRegistryIds = new Map(); // 字段名 → 注册表 id
    const effectRegIdList = [];          // 所有注册过的 id
    const effectRegistrar = readClass(src, `${EFFECT_PKG}ModEffects.class`);
    for (const m of effectRegistrar?.methods || []) {
      const seq = m.consts?.seq || [];
      let lastRegId = '';
      for (const s of seq) {
        if (s.kind === 'call' && (s.name === 'register' || s.name === 'registerMobEffect')) {
          const rid = s.args.find((a) => typeof a === 'string');
          if (rid) { lastRegId = rid; effectRegIdList.push(rid); }
          continue;
        }
        if (s.kind === 'put' && s.name && lastRegId) {
          effectRegistryIds.set(s.name, lastRegId);
          lastRegId = '';
        }
      }
    }
    // 字段名（SCREAMING_SNAKE）→ 注册表 id
    const effectIdByField = new Map();
    for (const [field, rid] of effectRegistryIds) {
      effectIdByField.set(camelToSnake(field), rid);
    }

    // 语言文件里的 effect.goetydelight.<id>
    const langEffectIds = new Set();
    for (const src2 of [zh, en]) {
      for (const key of Object.keys(src2)) {
        const m = /^effect\.goetydelight\.([a-z0-9_]+)(?:\.description)?$/.exec(key);
        if (m) langEffectIds.add(m[1]);
      }
    }
    // 效果 id 的全集：注册过的 + 语言文件有的 + 类名推的（兜底）
    const effectIds = new Set([...effectRegIdList, ...langEffectIds]);
    for (const ec of effectClassList) {
      effectIds.add(camelToSnake(ec.simple.replace(/Effect$/, '')));
    }
    // 类名 → 类路径
    const effectById = new Map();
    for (const ec of effectClassList) {
      effectById.set(camelToSnake(ec.simple.replace(/Effect$/, '')), ec.path);
    }

    for (const id of [...effectIds].sort()) {
      // 优先按注册表 id 找类，找不到再按类名推的
      let clsPath = effectById.get(id) || '';
      if (!clsPath) {
        for (const ec of effectClassList) {
          if (effectIdByField.get(camelToSnake(ec.simple.replace(/Effect$/, ''))) === id) {
            clsPath = ec.path;
            break;
          }
        }
      }
      const cls = clsPath ? readClass(src, clsPath) : null;
      const attrs = [];
      for (const key of Object.keys(zh)) {
        const m = new RegExp(`^effect\\.goetydelight\\.${id}\\.([a-z_]+)$`).exec(key);
        if (m && m[1] !== 'description') attrs.push(m[1]);
      }
      // 持续时间 / 等级：MobEffect 的构造参数是 (int color)，
      // 颜色在 class 里；持续时间和等级多半走配置，不在 class 里 —— 留空比瞎猜好。
      const nums = ownNumbers(cls, 8);
      // 有些效果在语言文件里只有物品名（tainted_drink / soul_convergence_room
      // 既是效果也是物品），拿物品名兜底，别让条目空着名字。
      const itemName = zh[`item.goetydelight.${id}`] || en[`item.goetydelight.${id}`] || '';
      const nameZh = zh[`effect.goetydelight.${id}`] || itemName;
      const nameEn = en[`effect.goetydelight.${id}`] || en[`item.goetydelight.${id}`] || '';
      // 上游漏写语言条目时，从类名推一个可读名兜底（标明是推的）
      const clsSimple = clsPath ? clsPath.split('/').pop().replace('.class', '') : '';
      const derived = !nameZh && !nameEn ? deriveName(id, clsSimple) : '';
      out.delightEffect.push({
        id: `goetydelight_${id}`,
        registryId: `${mainNs}:${id}`,
        nameZh,
        nameEn: nameEn || derived,
        descriptionZh: zh[`effect.goetydelight.${id}.description`] || '',
        descriptionEn: en[`effect.goetydelight.${id}.description`] || '',
        class: clsPath ? clsPath.split('/').pop() : '',
        nameDerived: derived ? true : false,
        attributes: attrs,
        duration: null,
        amplifier: null,
        numbers: nums,
      });
    }

    // ---------- 3. 自定义附魔 ----------
    // ModEnchantments 这种是注册器（持有所有附魔的静态字段），不是附魔本身，排除。
    const enchantClasses = names
      .filter((n) => n.startsWith(ENCHANT_PKG) && n.endsWith('.class') && !n.includes('$'))
      .filter((n) => !/^Mod/.test(n.split('/').pop().replace('.class', '')))
      .map((n) => ({ path: n, simple: n.split('/').pop().replace('.class', '') }));

    // 注册器里 register("soul_mending") 的字符串就是真正的注册表 id，
    // 跟类名不一定一致（比如 SoulMendingEnchantment ↔ soul_mending，
    // 甚至有作者自己拼错的 THE_PALE_MESSRNGER —— 所以字段名推 id 不可靠，
    // 直接拿 register 的字符串当准）。
    // 字节码顺序：get ENCHANTMENTS → str "id" → call register → put FIELD
    const registryIds = new Map(); // 字段名 → 注册表 id
    const registryIdList = [];     // 注册顺序里的所有 id
    const registrar = readClass(src, `${ENCHANT_PKG}ModEnchantments.class`);
    for (const m of registrar?.methods || []) {
      const seq = m.consts?.seq || [];
      let lastRegId = '';
      for (const s of seq) {
        if (s.kind === 'call' && s.name === 'register') {
          const id = s.args.find((a) => typeof a === 'string');
          if (id) { lastRegId = id; registryIdList.push(id); }
          continue;
        }
        if (s.kind === 'put' && s.name && lastRegId) {
          registryIds.set(s.name, lastRegId);
          lastRegId = '';
        }
      }
    }
    // 字段名（SCREAMING_SNAKE）→ 注册表 id
    const idByField = new Map();
    for (const [field, rid] of registryIds) {
      idByField.set(camelToSnake(field), rid);
    }

    for (const ec of enchantClasses) {
      const base = ec.simple.replace(/Enchantment$/, '');
      const snake = camelToSnake(base);
      const cls = readClass(src, ec.path);
      // 注册表 id 优先用 register 的字符串；类名推的只当兜底
      const fieldName = Object.keys(registryIds).find((k) => camelToSnake(k) === snake) || '';
      const regId = (fieldName && registryIds.get(fieldName)) || snake;
      const registryId = `${mainNs}:${regId}`;
      const enchZh = zh[`enchantment.goetydelight.${snake}`] || zh[`enchantment.goetydelight.${snake}.description`] || '';
      const enchEn = en[`enchantment.goetydelight.${snake}`] || '';
      // 上游漏写语言条目时，从类名推一个可读名兜底（标明是推的）
      const derived = !enchZh && !enchEn ? deriveName(snake, ec.simple) : '';
      out.delightEnchant.push({
        id: `goetydelight_${snake}`,
        registryId,
        nameZh: enchZh,
        nameEn: enchEn || derived,
        descriptionZh: zh[`enchantment.goetydelight.${snake}.description`] || '',
        descriptionEn: en[`enchantment.goetydelight.${snake}.description`] || '',
        class: ec.simple,
        nameDerived: derived ? true : false,
        maxLevel: maxLevelOf(cls),
        numbers: ownNumbers(cls, 8),
      });
    }

    // ---------- 4. 自定义配方（核心引擎跳过的那些） ----------
    let recovered = 0;
    for (const f of listRecipeFiles(src, mainNs)) {
      const json = readJson(src, f.path);
      if (!json) continue;
      const type = String(json.type || '');
      const short = type.replace(/^minecraft:/, '').replace(/^goety:/, '').replace(/^goetydelight:/, '').replace(/^farmersdelight:/, '');
      if (CORE_RECIPE_TYPES.has(short)) continue; // 核心引擎已经收了
      const result = pickId(json.result);
      const entry = {
        id: f.id,
        type: short,
        rawType: type,
        result: result || '',
        count: Number(json?.result?.count ?? json?.count ?? 1) || 1,
        category: f.rel.includes('/') ? f.rel.split('/')[0] : '',
      };
      // 各类型的专属数值
      if (json.soulCost != null) entry.soulCost = Number(json.soulCost) || 0;
      if (json.duration != null) entry.duration = Number(json.duration) || 0;
      if (json.uses != null) entry.uses = Number(json.uses) || 0;
      if (json.experience != null) entry.experience = Number(json.experience) || 0;
      if (json.cookingtime != null) entry.cookingTime = Number(json.cookingtime) || 0;
      if (json.effect) entry.effect = String(json.effect);
      if (json.ingredient) entry.ingredient = pickId(json.ingredient);
      if (json.ingredients) entry.ingredients = json.ingredients.map(pickId).filter(Boolean);
      if (json.activation_item) entry.activationItem = pickId(json.activation_item);
      if (json.entity_to_sacrifice) entry.sacrifice = pickId(json.entity_to_sacrifice);
      if (json.sacrifice) entry.sacrifice = pickId(json.sacrifice);
      if (json.craftType) entry.craftType = String(json.craftType);
      if (json.ritual_type) entry.ritualType = String(json.ritual_type);
      if (json.base) entry.base = pickId(json.base);
      if (json.addition) entry.addition = pickId(json.addition);
      if (json.template) entry.template = pickId(json.template);
      out.delightRecipe.push(entry);
      recovered++;
    }
    if (recovered) {
      warnings.push(`Goety Delight 扩展：补回 ${recovered} 条自定义配方（goety:brewing / goety:ritual / farmersdelight:cooking 等），原引擎此前整批跳过`);
    }

    warnings.push(
      `Goety Delight 扩展：数值配置 ${out.delightConfig.length}、状态效果 ${out.delightEffect.length}、` +
      `附魔 ${out.delightEnchant.length}、自定义配方 ${out.delightRecipe.length}`
    );

    return { contents: out, warnings };
  },

  /**
   * 导出钩子：把「改过的数值」变成真正能生效的文件。
   *
   * Goety Delight 的数值同样在 Forge 配置里（config/goetydelight-common.toml），
   * 光把条目打进包没用 —— 不落到 toml 文件或运行时代码就等于没改。
   *
   * 判定「改过」的方式：把 overrides 里的值和条目原值比。
   * 没改的条目不进覆写文件 —— 免得把整个配置文件都覆盖一遍，
   * 那样用户改一个数值却要接受整个文件被重写。
   */
  onExport(ctx) {
    const { report, overrides = {} } = ctx || {};
    const edits = overrides.delightConfig || {};
    if (!Object.keys(edits).length) return { files: [], java: [], warnings: [] };

    const all = report?.contents?.delightConfig || [];
    const changed = [];
    for (const e of all) {
      const ov = edits[e.id];
      if (!ov || typeof ov !== 'object') continue;
      if (!('value' in ov)) continue;
      const nv = Number(ov.value);
      if (!Number.isFinite(nv)) continue;
      if (nv === Number(e.value)) continue; // 没真改
      changed.push({ ...e, originalValue: e.value, value: nv, path: e.registryId ? String(e.registryId).split(':')[1] : e.id });
    }
    if (!changed.length) return { files: [], java: [], warnings: [] };

    const files = [];
    const warnings = [];

    // ---- 1. TOML 覆写：按配置文件分组，一个文件对应一个 toml ----
    const byFile = new Map();
    for (const e of changed) {
      const f = e.configFile || 'goetydelight-common.toml';
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(e);
    }
    for (const [file, list] of byFile) {
      const dir = list[0].configDir || '';
      const rel = dir ? `config/${dir}/${file}` : `config/${file}`;
      files.push({
        path: rel,
        content: buildToml(list, { header: `Goety Delight 数值覆写 · ${file}（由 MC Studio 生成）` }),
        createOnly: false,
      });
    }

    // ---- 2. Java 覆写代码 ----
    // 放到 src/main/java 下，工程生成时才会被编译进 jar。
    // 包名用工程自己的（ctx.projectPkg），否则包名对不上，编译不过。
    const pkg = ctx?.projectPkg || 'com.example.mod';
    const javaCode = buildJava(changed, {
      modId: report?.meta?.id || 'goetydelight',
      projectModId: ctx?.projectModId || 'examplemod',
      pkg,
      configPkg: 'net.v_black_cat.goetydelight.config',
      className: 'GoetyDelightConfigOverrides',
      fileHint: 'goetydelight',
      modName: 'Goety Delight',
    });
    files.push({
      path: `src/main/java/${pkg.replace(/\./g, '/')}/config/GoetyDelightConfigOverrides.java`,
      content: javaCode,
      createOnly: false,
    });

    // ---- 3. 说明文档 ----
    files.push({
      path: 'goetydelight-config-overrides/README.md',
      content: buildReadme(changed, {
        source: report?.meta?.name || 'Goety Delight',
        modName: 'Goety Delight',
        className: 'GoetyDelightConfigOverrides',
      }),
      createOnly: false,
    });

    warnings.push(
      `Goety Delight 扩展：${changed.length} 项数值改动已生成覆写产物` +
      `（${byFile.size} 个 toml + 1 份 Java 代码）`
    );

    return { files, java: [], warnings };
  },
};
