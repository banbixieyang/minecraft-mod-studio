/**
 * 宝箱 / 战利品表生成器。
 *
 * 纯数据驱动：每个条目产出一份 data/<ns>/loot_table/<id>.json。
 * 战利品表用经典 pools / functions / function 格式 —— 这套在 1.20.1 与 26.x 的
 * 宝箱 / 实体 / 钓鱼表里都通用（只有 block 掉落那套在 1.21 改成了 modifier，
 * 但 chest/entity/fishing 仍是 functions）。
 *
 * 单池模型：一个掉落池，列出所有物品，每个物品带权重 + 数量区间 + 可选随机附魔。
 * 覆盖「宝箱」最常见的需求；多池（独立概率池）以后按需再加。
 */
export default {
  emit(ctx) {
    const entries = ctx.entriesOf('loot_table');
    if (!entries.length) return;
    const { ns } = ctx;
    const j = (o) => JSON.stringify(o, null, 2);
    // 1.21 起数据包目录从复数改单数；1.20.1 必须写 loot_tables，否则游戏找不到表。
    const lootDir = ctx.adapter?.features?.resourceFormat === '1.20.1' ? 'loot_tables' : 'loot_table';

    for (const e of entries) {
      const id = e.id || 'loot';
      const type = e.type || 'minecraft:chest';
      const items = (Array.isArray(e.items) ? e.items : [])
        .map((x) => String(x).trim())
        .filter(Boolean);
      const min = Math.max(1, Number(e.countMin) || 1);
      const max = Math.max(min, Number(e.countMax) || min);
      const weight = Math.max(1, Number(e.weight) || 1);
      const enchant = !!e.enchant;

      if (type === 'minecraft:empty' || !items.length) {
        ctx.addFile(`src/main/resources/data/${ns}/${lootDir}/${id}.json`, j({ type: 'minecraft:empty', pools: [] }));
        continue;
      }

      // 每个物品共享同一组函数（数量区间 + 可选附魔）
      const functions = [];
      if (min !== 1 || max !== 1) {
        functions.push({
          function: 'minecraft:set_count',
          count: min === max ? min : { type: 'minecraft:uniform', min, max },
          add: false,
        });
      }
      if (enchant) functions.push({ function: 'minecraft:enchant_randomly', treasure: false });

      const ents = items.map((it) => {
        const name = it.includes(':') ? it : `${ns}:${it}`;
        const entry = { type: 'minecraft:item', name, weight };
        if (functions.length) entry.functions = functions;
        return entry;
      });

      const table = {
        type,
        pools: [{ rolls: 1, entries: ents }],
        random_sequence: `${ns}:${id}`,
      };
      ctx.addFile(`src/main/resources/data/${ns}/${lootDir}/${id}.json`, j(table));
    }
  },
};
