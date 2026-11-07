/**
 * 测试公用的工程准备。
 *
 * 刻意**不删除**目录：跑测试不该带 `rm -rf` 的破坏力（analyze.mjs 早先也踩过这个坑）。
 * 目录已经是工程就直接复用（用例只覆盖 entries，本来也不需要干净目录），
 * 不是工程才新建。projects/ 下的残留和 fieldstest-* 一样留着，要清是另一件事。
 *
 * 顺带：批量删除还会撞上环境的 safe-delete 阈值，整批用例直接跑不下去。
 */
import * as P from '../core/project.mjs';

/**
 * @param {string} root 工程目录
 * @param {object} meta 传给 createProject 的元信息（只在目录还不在时用到）
 * @returns {object} 已加载的工程数据
 */
export function openProject(root, meta) {
  if (!P.isProject(root)) P.createProject(root, meta);
  return P.loadProject(root);
}
