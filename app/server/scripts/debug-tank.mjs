// 调试脚本： dump 指定缸每条回答的 stance/strategy 得分与命中，用于判断
// 「数据论证 10/10」到底是真实数字证据还是兜底/裸数字密度造成的。
import { readFile } from 'node:fs/promises';

import { annotateOne, classifyQuestion } from '../src/annotator.js';

const raw = JSON.parse(await readFile(new URL('../data/raw-tanks.json', import.meta.url), 'utf8'));
const q = process.argv[2] || '清朝人口';

const tank = raw.find((item) => item.question.includes(q));
if (!tank) {
  console.error('tank not found');
  process.exit(1);
}
const questionType = classifyQuestion(tank.question);
console.log(`Q: ${tank.question}  [type=${questionType.type}]`);

// 复制 annotateOne 内部打分的可见版本：直接从导出入口拿 evidence，
// 需要逐词典得分时用内部重算（与 annotateOne 同逻辑的关键词扫描）。
for (const [i, answer] of (tank.answers || []).entries()) {
  const excerpt = String(answer?.excerpt || answer?.content || '');
  const annotation = annotateOne(tank.question, { ...answer, excerpt }, { questionType });
  console.log(
    `#${i} stance=${annotation.stance} strategy=${annotation.strategy} conf=${annotation.confidence}`,
  );
  console.log(`   strategyEvidence=${JSON.stringify(annotation.evidence.strategy)}`);
  console.log(`   stanceEvidence=${JSON.stringify(annotation.evidence.stance)}`);
  console.log(`   head=${excerpt.slice(0, 40).replace(/\n/g, ' ')}`);
}
