/**
 * 进度模块的生成器 —— 这就是「模块自带额外产出」的完整写法。
 *
 * 引擎只负责把表单数据交过来，产出什么由模块自己决定。
 * 这里产两样东西：
 *   1. data/<ns>/advancement/<id>.json —— 进度本体
 *   2. 两条语言键（标题/描述），通过 ctx.addLang 合进引擎生成的语言文件
 *
 * 想加自己的内容类型？照抄这个目录，改 module.json 的 fields 和这里的 emit。
 */
import { toPascal } from '../../core/ids.mjs';

const j = (o) => JSON.stringify(o, null, 2) + '\n';

export default {
  emit(ctx) {
    const { project, ns } = ctx;
    const list = ctx.entriesOf('advancement');
    if (!list.length) return;

    const items = ctx.entriesOf('item');
    // 方块在物品栏里也是物品，图标同样能用 —— 一起算进「本模组自己的 id」
    const ownIds = new Set([
      ...items.map((i) => i.id),
      ...ctx.entriesOf('block').map((b) => b.id),
    ]);

    /** 短名补全命名空间；项目里没有的当原版方块/物品处理 */
    const resolve = (ref, fallback) => {
      const v = String(ref || '').trim();
      if (!v) return fallback;
      if (v.includes(':')) return v;
      return ownIds.has(v) ? `${ns}:${v}` : `minecraft:${v}`;
    };

    for (const adv of list) {
      const icon = resolve(adv.icon, items.length ? `${ns}:${items[0].id}` : 'minecraft:stone');
      const trigger = resolve(adv.triggerItem, null);

      const criteria = trigger
        ? {
            got_item: {
              trigger: 'minecraft:inventory_changed',
              conditions: { items: [{ items: trigger }] },
            },
          }
        : // 没有触发条件时用 impossible：只能靠 /advancement grant 发放。
          // 好处是进度照样能挂在界面上当展示用，不会自己弹出来。
          { manual: { trigger: 'minecraft:impossible' } };

      const display = {
        icon: { id: icon },
        title: adv.titleZh || toPascal(adv.id),
        description: adv.descriptionZh || '',
        frame: adv.frame || 'task',
        show_toast: true,
        announce_to_chat: adv.announce !== false,
        hidden: !!adv.hidden,
      };

      const body = {
        display,
        criteria,
        requirements: [Object.keys(criteria)],
      };

      // parent 允许写原版进度（story/root），也允许写本模组的短名
      if (adv.parent) {
        const p = String(adv.parent).trim();
        body.parent = p.includes(':') ? p : `${ns}:${p}`;
      } else {
        // 没有父进度 = 根进度。可见的根进度必须带背景图，
        // 否则游戏启动时直接报 "Visible advancement roots must have background" 并且拒绝加载。
        display.background =
          adv.background || 'minecraft:textures/gui/advancements/backgrounds/stone.png';
      }

      ctx.addFile(`src/main/resources/data/${ns}/advancement/${adv.id}.json`, j(body));

      // 语言键：Minecraft 优先用 display.title 的字面量，这里同时写一份 key 方便以后做多语言
      ctx.addLang(
        `advancement.${ns}.${adv.id}.title`,
        adv.titleZh || toPascal(adv.id),
        adv.titleEn || adv.titleZh || toPascal(adv.id),
      );
      if (adv.descriptionZh) {
        ctx.addLang(
          `advancement.${ns}.${adv.id}.description`,
          adv.descriptionZh,
          adv.descriptionEn || adv.descriptionZh,
        );
      }

      ctx.log(`进度 ${adv.id} → 图标 ${icon}${trigger ? `，触发物品 ${trigger}` : '，手动发放'}`);
    }
  },
};
