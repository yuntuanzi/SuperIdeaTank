// 离线评估脚本：对两套人工锚点跑标注器，输出立场/策略命中率与逐条明细。
// 只读 fixtures（验收闸），不做任何网络调用，供 ANNOTATOR-ROUND2 改动前后对照。
import { readFile } from 'node:fs/promises';

import { annotateOne, classifyQuestion } from '../src/annotator.js';

const files = [
  ['v1', '../../../docs/evidence/annotator-fixtures.json'],
  ['v2', '../../../docs/evidence/annotator-fixtures-v2.json'],
];

for (const [name, rel] of files) {
  const fixtures = JSON.parse(await readFile(new URL(rel, import.meta.url), 'utf8')).fixtures;
  let stanceHit = 0;
  let strategyHit = 0;
  const rows = [];
  for (const fixture of fixtures) {
    const annotation = annotateOne(
      fixture.question,
      { excerpt: fixture.excerpt, ...fixture.meta },
      { questionType: classifyQuestion(fixture.question) },
    );
    const sOk = annotation.stance === fixture.expect.stance;
    const gOk = annotation.strategy === fixture.expect.strategy;
    if (sOk) stanceHit += 1;
    if (gOk) strategyHit += 1;
    rows.push(
      `${fixture.id} stance=${annotation.stance}${sOk ? '✓' : `✗(期望${fixture.expect.stance})`} ` +
        `strategy=${annotation.strategy}${gOk ? '✓' : `✗(期望${fixture.expect.strategy})`} conf=${annotation.confidence}`,
    );
  }
  console.log(`== ${name}: stance ${stanceHit}/${fixtures.length}  strategy ${strategyHit}/${fixtures.length}`);
  for (const row of rows) console.log('   ' + row);
}
