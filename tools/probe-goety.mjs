/**
 * 一次性探测：找 Goety 的施法 API（跑完可删）。
 */
import { openSource } from '../core/analyze/sources.mjs';
import { parseClass } from '../core/analyze/classfile.mjs';

const jar = process.argv[2] || 'C:/Users/Lenovo/Downloads/goety-2.5.55.4.jar';
const src = openSource(jar);

const names = src.allNames || [];
const classes = names.filter((n) => n.endsWith('.class'));
console.log('class 总数:', classes.length);

// 找 util 包下的类
const utilClasses = classes.filter((n) => /common\/util\//.test(n) && !n.includes('$'));
console.log('\n--- common/util 下的类 ---');
for (const c of utilClasses.slice(0, 40)) console.log(' ', c);

const SPELL_PKG = 'com/Polarice3/Goety/common/magic/spells/';
console.log('\n--- 法术类（前 15 个）---');
for (const c of classes.filter((n) => n.startsWith(SPELL_PKG) && !n.includes('$')).slice(0, 15)) {
  console.log(' ', c);
}
