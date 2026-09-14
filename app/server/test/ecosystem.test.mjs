// 用记录下来的响应和拒绝联网的替身验证主链，避免验收再次耗掉真实额度。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as ecosystem from '../src/ecosystem.js';
import { survivalRule } from '../src/ruleModel.js';
import { demoEcosystem } from '../src/demoData.js';

globalThis.fetch = async () => { throw new Error('测试禁止真实网络'); };
const saved = JSON.parse(fs.readFileSync(new URL('../../../docs/evidence/zhida-explain-2026-09-13.json', import.meta.url), 'utf8'));
// 留证文件把末尾换行写成了字面量转义；只在 fixture 装载处去掉这一层封装。
const savedBody = JSON.parse(saved.rawResponse.replace(/\\n$/, ''));
const narrative = savedBody.choices[0].message.content;
const item = { id: 'one', title: '如何看待这个方案？', excerpt: '我赞成，确实值得肯定。数据显示平均增长20%，占比30%。', votes: 2, comments: 0, authority: 1, author: '样本', url: '', featuredComments: [] };
const question = item.title;
const options = (overrides = {}) => ({ search: async () => [item], answers: async () => ({ items: [item] }), chat: async () => { throw new Error('额度耗尽'); }, ...overrides });

// 五派和优势结论都来自实测响应，防止仅对自造理想格式有效。
test('真实 Markdown 解析出五派并保留独立优势小节', () => {
  const parsed = ecosystem.parseAiNarrative(narrative);
  assert.equal(parsed.aiFactions.length, 5);
  assert.equal(parsed.aiFactions[1].name, '法律拆解派');
  assert.match(parsed.aiFactions[1].claim, /劳动合同法/);
  assert.match(parsed.aiFactions[1].persuasion, /引法条/);
  assert.match(parsed.aiDominant, /清醒批评/);
  for (const faction of parsed.aiFactions) {
    assert.ok(faction.claim.length <= 120 && faction.persuasion.length <= 80);
  }
  assert.ok(parsed.aiDominant.length <= 200);
});

// 直答没有格式承诺，格式漂移应局部降级而不是导致整个缸失败。
test('无格式文本解析降级，不抛异常；编号标题与空字段可用', () => {
  assert.deepEqual(ecosystem.parseAiNarrative('完全自由的回答'), { aiFactions: null, aiDominant: null });
  assert.deepEqual(ecosystem.parseAiNarrative(null), { aiFactions: null, aiDominant: null });
  const parsed = ecosystem.parseAiNarrative('## 1. 理性派：「副标题」\n没有固定字段\n## 谁最占上风\n暂时没有结论');
  assert.deepEqual(parsed.aiFactions, [{ name: '理性派', claim: '', persuasion: '' }]);
  assert.equal(parsed.aiDominant, '暂时没有结论');
});

// 解说走 DeepSeek 的严格 JSON 契约（system 定枚举与结构，user 给样本），
// 因此这里锁的是「提示词分层」与「历史 Markdown 仍可解析」两件事。
test('解说用 system+user 两条消息发起，来源标记为 deepseek，历史 Markdown 仍可解析', async () => {
  let calls = 0;
  let seen = null;
  const result = await ecosystem.explainEcosystem(question, [item], options({ chat: async (messages, opts) => {
    calls++;
    seen = { messages, opts };
    return narrative;
  } }));
  assert.equal(calls, 1);
  assert.equal(result.aiNarrative, narrative);
  assert.match(result.aiNarrativeSource, /^deepseek:/);
  // 历史留证是直答时代的 Markdown，换装后仍必须解析出派系，不能因为不是 JSON 就丢
  assert.equal(result.aiFactions.length, 5);
  const { messages, opts } = seen;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  // 官方 json_object 模式要求提示词内必须出现 "json" 字样
  assert.match(messages[0].content, /JSON/);
  assert.match(messages[0].content, /factions/);
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes(question));
  assert.match(messages[1].content, /本缸共 1 个回答样本/);
  assert.equal(opts.json, true);
});

// 额度不足和解析失败是两个独立故障，两者都不能抹掉本地标注。
test('解说失败和不可解析格式均不阻断构建', async () => {
  const failed = await ecosystem.buildEcosystem(question, '', options());
  assert.equal(failed.species.length, 1);
  assert.equal(failed.species[0].annotationSource, 'local-heuristic');
  assert.equal(typeof failed.species[0].confidence, 'number');
  assert.ok(failed.species[0].evidence.strategy.length);
  assert.equal(failed.aiNarrative, null);
  assert.match(failed.aiNarrativeError, /额度耗尽/);
  assert.ok(failed.annotationWarning);
  assert.ok(failed.narrative);
  const unstructured = await ecosystem.buildEcosystem(question, '', options({ chat: async () => '  自由文本\n' }));
  assert.equal(unstructured.aiNarrative, '  自由文本\n');
  assert.equal(unstructured.aiFactions, null);
});

// 两个入口容易遗漏新增字段或重复调用，必须检查同一返回契约。
test('URL 与搜索两条构建通道均只调用一次解说，证据来自展示文本', async () => {
  for (const url of ['', 'https://www.zhihu.com/question/123']) {
    let calls = 0;
    const tank = await ecosystem.buildEcosystem(question, url, options({ chat: async () => { calls++; return narrative; } }));
    assert.equal(calls, 1);
    assert.equal(tank.species[0].stance, '支持');
    assert.ok(tank.species[0].evidence.stance.every(e => tank.species[0].excerpt.includes(e.term) || e.weight === 0));
    assert.equal(tank.aiFactions.length, 5);
  }
});

// 空缸不值得消耗额度，主动关闭 AI 时也应得到可用响应。
test('不请求 AI 和无回答时均保持完整空值契约', async () => {
  let calls = 0;
  const noAi = await ecosystem.buildEcosystem(question, '', options({ includeAi: false, chat: async () => { calls++; return narrative; } }));
  const empty = await ecosystem.buildEcosystem(question, '', options({ search: async () => [], chat: async () => { calls++; return narrative; } }));
  assert.equal(calls, 0);
  for (const tank of [noAi, empty]) {
    assert.equal(tank.aiNarrative, null);
    assert.equal(tank.aiFactions, null);
    assert.equal(tank.aiDominant, null);
    assert.equal(tank.aiNarrativeSource, null);
  }
});

// 用试图改写概率的 AI 内容检验隔离边界，防止结构化混合路径回归。
test('放生立场由草稿决定，AI 点评不参与规则分值/风险/建议', async () => {
  const draft = item.excerpt.repeat(30);
  const report = await ecosystem.analyzeRelease(question, [], draft, options({ chat: async (messages, opts) => {
    assert.equal(opts.json, true);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    assert.ok(messages[1].content.includes(draft.slice(0, 800)));
    assert.ok(!messages[1].content.includes(draft.slice(0, 801)));
    // 关键：JSON 里塞入 survivalProbability / risks / stance，试图覆盖规则结论。
    // 契约只认 comment，其余字段一律不得生效。
    return '{"survivalProbability":0,"risks":["AI 覆盖"],"stance":"反对","comment":"这条回答大概率会被压制，评论区多半不买账。"}';
  } }));
  assert.equal(report.stance, '支持');
  assert.equal(report.analysisSource, 'rule+local+ai');
  const rule = survivalRule([], report);
  assert.equal(report.survivalProbability, rule.probability);
  assert.equal(report.ruleProbability, rule.probability);
  assert.equal(report.aiProbability, null);
  assert.deepEqual(report.risks, rule.risks);
  assert.deepEqual(report.hybridAdvice, rule.advice);
  assert.equal(report.suppressedBy, rule.suppressedBy);
  assert.equal(report.aiComment, '这条回答大概率会被压制，评论区多半不买账。');
  assert.match(report.aiInsightSource, /^deepseek:/);
  // 没有 comment 字段（只塞数值）时不得展示点评：AI 不能靠越权字段混进正文
  const numericOnly = await ecosystem.analyzeRelease(question, [], draft, options({ chat: async () => '{"survivalProbability":0,"risks":["AI 覆盖"]}' }));
  assert.equal(numericOnly.aiComment, null);
  assert.equal(numericOnly.analysisSource, 'rule+local');
  assert.equal(numericOnly.survivalProbability, rule.probability);
  const failed = await ecosystem.analyzeRelease(question, [], item.excerpt, options());
  assert.equal(failed.analysisSource, 'rule+local');
  assert.equal(failed.aiComment, null);
});

// 已缓存的全灰数据会绕过新构建，迁移必须保留原始对象并补足新契约。
test('旧缓存只在内存重标，保留已有 AI；演示证据不伪装成机器命中', () => {
  const old = { question, species: [{ ...item, stance: '中立', strategy: '数据论证', annotationSource: 'none' }], aiNarrative: narrative, aiNarrativeSource: 'zhida-thinking-1p5' };
  const refreshed = ecosystem.refreshLocalAnnotations(old);
  assert.equal(refreshed.species[0].annotationSource, 'local-heuristic');
  assert.equal(old.species[0].annotationSource, 'none');
  assert.equal(refreshed.aiNarrative, narrative);
  assert.equal(refreshed.aiFactions.length, 5);
  const demo = demoEcosystem(question);
  assert.equal(demo.aiNarrative, null);
  assert.equal(demo.aiFactions, null);
  assert.ok(demo.species.every(s => s.annotationSource === 'demo' && s.confidence === 0 && s.evidence.stance.length));
});

// 附录允许标题没有空格，避免轻微排版差异丢掉整组真实派系。
test('无空格的 Markdown 标题仍能解析五派和优势结论', () => {
  const parsed = ecosystem.parseAiNarrative(narrative.replace(/## /g, '##'));
  assert.equal(parsed.aiFactions?.length, 5);
  assert.match(parsed.aiDominant, /清醒批评/);
});
