import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { annotateAll, annotateOne, classifyQuestion } from '../src/annotator.js';

// 这些锚点来自真实缓存而非为规则量身打造，能防止实现退化成 fixture id 或整句记忆。
const fixtures = JSON.parse(
  await readFile(new URL('../../../docs/evidence/annotator-fixtures.json', import.meta.url), 'utf8'),
).fixtures;

test('classifyQuestion covers the four prior types', () => {
  const cases = [
    ['如何看待年轻人拒绝无效加班？', 'judgement'],
    ['这项制度是不是合理？', 'judgement'],
    ['为什么年轻人开始反感「无效加班」？', 'why'],
    ['用户增长停滞是何原因？', 'why'],
    ['如何提升回答的说服力？', 'howto'],
    ['有哪些适合新人学习的工具推荐？', 'howto'],
    ['读研三年和工作三年，差距有多大？', 'open'],
    ['分享一次你印象最深的职场经历', 'open'],
  ];

  for (const [question, type] of cases) {
    assert.equal(classifyQuestion(question).type, type, question);
  }
});

test('annotates real Zhihu anchors above the required hit rate', () => {
  const results = fixtures.map((fixture) => {
    const annotation = annotateOne(
      fixture.question,
      {
        excerpt: fixture.excerpt,
        ...fixture.meta,
      },
      { questionType: classifyQuestion(fixture.question) },
    );
    return { fixture, annotation };
  });

  // 启发式标注器有明确上限，测试只锁住 spec 要求的最低可用准确率。
  const stanceHits = results.filter(({ fixture, annotation }) => annotation.stance === fixture.expect.stance);
  const strategyHits = results.filter(({ fixture, annotation }) => annotation.strategy === fixture.expect.strategy);

  assert.ok(stanceHits.length >= 8, `stance hit ${stanceHits.length}/12`);
  assert.ok(strategyHits.length >= 9, `strategy hit ${strategyHits.length}/12`);

  for (const { annotation } of results) {
    assert.equal(typeof annotation.confidence, 'number');
    assert.ok(annotation.confidence >= 0 && annotation.confidence <= 1);
    assert.ok(Array.isArray(annotation.evidence.stance));
    assert.ok(Array.isArray(annotation.evidence.strategy));
  }
});

test('annotateAll warns when one distribution collapses', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    id: `plain-${index}`,
    excerpt: `这是一段普通说明文字 ${index}，没有明显观点，只是在补足背景信息。`,
  }));

  const result = annotateAll('分享一次普通经历', items);
  assert.equal(result.items.length, 10);
  assert.ok(result.annotationWarning);
});

test('low evidence text falls back to neutral with explicit low-confidence evidence', () => {
  const result = annotateOne('分享一次普通经历', { excerpt: '今天看到了一个情况，记录一下。' });

  assert.equal(result.stance, '中立');
  assert.ok(result.confidence < 0.15);
  assert.deepEqual(result.evidence.stance[0], { term: '特征不足', weight: 0 });
});

test('one sarcasm feature alone is not enough to classify as sarcasm', () => {
  const result = annotateOne('如何看待这个方案？', {
    excerpt: '这个方案学会了，但后面还需要补充具体数据和执行条件。',
  });

  assert.notEqual(result.stance, '反讽');
});

test('adversarial priors dampen all stance signals for string ctx too', () => {
  // 归因题的否定密度也必须被先验衰减，否则解释性文本会因为“不/没/无”过多变成反对。
  const result = annotateOne(
    '为什么年轻人开始反感无效加班？',
    { excerpt: '不是不能努力，也不是没有责任，更不是不愿成长，只是原因需要拆开看。' },
    { questionType: 'why' },
  );

  assert.notEqual(result.stance, '反对');
});

test('adversarial hard authority beats dense numbers', () => {
  // 法条和脚注是来源结构，哪怕同段里堆了很多数字，也应优先解释为引用权威。
  const result = annotateOne('如何看待四年合同不续签？', {
    excerpt:
      '《劳动合同法》第14条已经写清楚，[1][2]。这里还有1、2、3、4、5、6、7、8、9、10个成本数字，金额100元、200元、300元都只是辅助。',
  });

  assert.equal(result.strategy, '引用权威');
  assert.ok(result.evidence.strategy.some((hit) => hit.term.includes('劳动合同法') || hit.term.includes('第14条')));
});

test('adversarial strong story beats emotional wording', () => {
  // 亲历时间线才是说服方式主轴，情绪词只是故事里的气氛，不能抢走策略类别。
  const result = annotateOne('读研三年和工作三年，差距有多大？', {
    excerpt:
      '2019年，我在北京认识同事老陈，月薪9000元。那年他后来去了深圳，我记得饭桌上大家都很累、很委屈、很无奈、很心疼、真心觉得扛不住。',
  });

  assert.equal(result.strategy, '故事叙事');
});

test('adversarial evidence uses matched text and adjusted weights', () => {
  // 前端展示的是“为什么判成这样”，regex source 和未记录的优先加分都不能算可解释证据。
  const result = annotateOne('如何看待这件事？', {
    excerpt: '《劳动合同法》第14条说明了依据，[1]，另有20个数字。',
  });

  assert.equal(result.strategy, '引用权威');
  assert.ok(result.evidence.strategy.every((hit) => !hit.term.includes('\\d') && !hit.term.includes('[^')));
  assert.ok(result.evidence.strategy.some((hit) => hit.weight > 3.6));
});

test('adversarial stance ignores author and badge text', () => {
  // 作者名和徽章不是回答立场；把它们混进 stance 会让“狗头教授”这种名字污染分类。
  const result = annotateOne('如何看待这个方案？', {
    excerpt: '今天记录一个普通现象，没有明确判断。',
    author: '狗头教授',
    badgeText: '劳动合同法研究者',
  });

  assert.notEqual(result.stance, '反讽');
});

test('adversarial pun and absurd proposal are bounded', () => {
  // “建议”只有荒诞提案语境才算抖机灵；谐音/双关则用有限梗词覆盖，不靠样本整句。
  const normal = annotateOne('如何提升回答质量？', { excerpt: '建议先补充数据来源，再写清楚执行条件。' });
  const pun = annotateOne('如何看待降薪换双休？', { excerpt: '这不是降薪，是把心薪都拿回来。' });

  assert.notEqual(normal.strategy, '抖机灵');
  assert.equal(pun.strategy, '抖机灵');
});
