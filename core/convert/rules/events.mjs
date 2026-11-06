/**
 * 规则：加载器事件 / 注册 API —— 只提示，不硬翻。
 *
 * Fabric 的事件回调和 Forge 的事件总线连参数形状都不一样，
 * 字符串替换只会产出「看起来对、一编译就炸」的代码。
 * 这里保留原代码 + 写 TODO，并把对应的 Forge/Fabric 做法写进报告。
 */
import { loaderMarkersIn, EVENT_CONCEPTS } from '../symbols.mjs';

export const rule = {
  id: 'builtin.events',
  label: '加载器事件与注册',
  description: '识别绑死加载器的事件 API，给出目标平台的等价概念与改写要点',
  priority: 70,
  convert(ctx) {
    const items = [];
    const changes = {};
    if (ctx.from.platform === ctx.to.platform) {
      return { items, changes, notes: ['同加载器，事件 API 不用换'] };
    }
    const srcKey = ctx.from.platform === 'forge' ? 'forge' : 'fabric';
    for (const part of ctx.parts.filter((p) => p.kind === 'java')) {
      const markers = loaderMarkersIn(part.code, srcKey);
      if (!markers.length) continue;
      const hitConcepts = EVENT_CONCEPTS.filter((c) => part.code.includes(c[srcKey]));
      const todos = [];
      for (const c of hitConcepts) {
        const targetSpelling = srcKey === 'fabric' ? c.forge : c.fabric;
        const srcSpelling = c[srcKey];
        items.push({
          id: `${part.id}/event/${c.concept}`, kind: 'java', label: c.concept,
          status: 'manual', confidence: 0.3, rule: rule.id,
          before: srcSpelling, after: targetSpelling,
          notes: [`${c.concept}：${srcSpelling} → ${targetSpelling}。${c.how}`],
          suggestion: `在目标工程里按「${c.concept}」重写这段回调，再生成 + 构建验证。`,
        });
        todos.push(`${c.concept}：${srcSpelling} 需改写成 ${targetSpelling}；${c.how}`);
      }
      if (!hitConcepts.length) {
        items.push({
          id: `${part.id}/event/generic`, kind: 'java', label: '加载器专属 API',
          status: 'manual', confidence: 0.3, rule: rule.id,
          notes: [`检测到 ${markers.slice(0, 4).join('、')}，但没有登记等价概念；原样保留，请按目标加载器的事件文档重写。`],
          suggestion: '在知识库搜目标加载器的任务卡，或写一个自定义转换规则补上这个映射。',
        });
        todos.push(`检测到加载器专属 API（${markers.slice(0, 3).join('、')}），需按目标加载器重写`);
      }
      changes[part.id] = { todo: todos };
    }
    return { items, changes, notes: [] };
  },
};
