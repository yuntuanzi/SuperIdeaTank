import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { annotateOne, classifyQuestion } from '../src/annotator.js';

// 这道闸把 ANNOTATOR-ROUND2-SPEC 3.1 的两套人工锚点门槛写成断言：
// 以后任何人改标注器，只要锚点命中率掉线，测试就会红。
// 两个 fixtures json 是人工标注的验收闸，测试只读不写。
const v1 = JSON.parse(
  await readFile(new URL('../../../docs/evidence/annotator-fixtures.json', import.meta.url), 'utf8'),
).fixtures;
const v2 = JSON.parse(
  await readFile(new URL('../../../docs/evidence/annotator-fixtures-v2.json', import.meta.url), 'utf8'),
).fixtures;

function run(fixtures) {
  return fixtures.map((fixture) => ({
    fixture,
    annotation: annotateOne(
      fixture.question,
      { excerpt: fixture.excerpt, ...fixture.meta },
      { questionType: classifyQuestion(fixture.question) },
    ),
  }));
}

function hitRates(results) {
  const stance = results.filter(({ fixture, annotation }) => annotation.stance === fixture.expect.stance).length;
  const strategy = results.filter(({ fixture, annotation }) => annotation.strategy === fixture.expect.strategy).length;
  return { stance, strategy, total: results.length };
}

test('v1 anchors keep the round-1 floors (stance >= 9/12, strategy >= 11/12)', () => {
  const { stance, strategy, total } = hitRates(run(v1));
  assert.ok(stance >= 9, `v1 stance hit ${stance}/${total}`);
  assert.ok(strategy >= 11, `v1 strategy hit ${strategy}/${total}`);
});

test('v2 anchors capture opening verdicts (stance >= 7/10, strategy >= 7/10)', () => {
  const { stance, strategy, total } = hitRates(run(v2));
  assert.ok(stance >= 7, `v2 stance hit ${stance}/${total}`);
  assert.ok(strategy >= 7, `v2 strategy hit ${strategy}/${total}`);
});

test('opening verdict is positional: same words mid-text do not trigger it', () => {
  // 判词特征的价值在位置；把「不能」藏进论证中段不应再享受首句权重，
  // 这条断言防的是有人把首句词典退回成全文词频。
  const verdict = annotateOne('这一结果能否平息争议？', { excerpt: '不能。因为争议的根源根本不在调查结果上。' });
  const buried = annotateOne('这一结果能否平息争议？', {
    excerpt: '先说背景。很多人以为关键在调查结果，其实不能这么简单看，争议的根源在别处。',
  });
  assert.equal(verdict.stance, '反对');
  assert.notEqual(buried.evidence.stance[0]?.term, '不能');
});

test('neutral via positive features keeps real confidence, fallback neutral stays low', () => {
  // spec 2.3：命中正向特征的中立是「真中立」，要有实打实的 confidence；
  // 什么特征都没有的兜底中立仍然低置信度，两个标签不再混为一体。
  const positive = annotateOne('这件事有标准答案吗？', {
    excerpt: '这没有标准答案，见仁见智，不同立场的两边都有道理。',
  });
  const fallback = annotateOne('分享一次普通经历', { excerpt: '今天看到了一个情况，记录一下。' });

  assert.equal(positive.stance, '中立');
  assert.ok(positive.confidence >= 0.15, `positive neutral conf=${positive.confidence}`);
  assert.equal(fallback.stance, '中立');
  assert.ok(fallback.confidence < 0.15, `fallback neutral conf=${fallback.confidence}`);
});
