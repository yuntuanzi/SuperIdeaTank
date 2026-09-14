// AI 输出契约的单测：全部用替身 chat，不联网、不消耗 DeepSeek 额度。
//
// 覆盖两类真实踩过的坑：
//  ① 推理模型的思考与正文共享 max_tokens，额度耗尽会把 JSON 截在半个字段上
//     → 必须能抢救出「已经写完整」的部分，而不是整批判死回退本地；
//  ② 模型自创标签（「温和反对」「理性派」）→ 必须整条回退本地，
//     绝不能以「AI 判定」的身份进入前端配色与统计。
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, extractJsonLenient } from '../src/aiClient.js';
import { aiAnnotateSpecies, aiClassifyQuestion, aiSourceLabel, isAiSource } from '../src/aiAnnotator.js';

const question = '如何看待「年轻人越来越不愿意加班」这一现象？';
const rows = ['我赞成，数据显示平均增长 20%。', '我反对，纯属浪费时间。', '嗯，反正就是累。'].map((excerpt, i) => ({
  id: `a${i + 1}`,
  excerpt,
  votes: null,
  badgeText: '',
  authority: 1,
}));

// ---------- JSON 抽取与截断抢救 ----------

test('extractJson 严格：容忍围栏与前后噪声，未闭合必须报错', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('说明 {"a":[1,2]} 尾巴'), { a: [1, 2] });
  assert.throws(() => extractJson('{"a":[1,2'), /未闭合/);
  assert.throws(() => extractJson('没有 JSON'), /未找到/);
  assert.throws(() => extractJson(''), /为空/);
});

test('截断抢救：factions 写完整、dominant 被截断时仍取出派系', () => {
  const text =
    '{"factions":[{"name":"法律拆解派","claim":"依据法条","persuasion":"引法条"},' +
    '{"name":"亲历吐槽派","claim":"太累了","persuasion":"共鸣"}],"dominant":"法律拆解派最占上风，因';
  const { data, repaired } = extractJsonLenient(text);
  assert.equal(repaired, true);
  assert.equal(data.factions.length, 2);
  assert.equal(data.factions[1].name, '亲历吐槽派');
  // 被截断的字段不得凭空补出
  assert.equal(data.dominant, undefined);
});

test('截断抢救：数组尾部元素不完整时丢弃该条，而不是整批作废', () => {
  const text = '{"items":[{"i":1,"stance":"反对","strategy":"数据论证","confidence":0.6},{"i":2,"stance":"支持","strat';
  const { data, repaired } = extractJsonLenient(text);
  assert.equal(repaired, true);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].i, 1);
});

test('截断抢救：字符串内的括号与转义引号不干扰边界判断', () => {
  const text = '{"items":[{"i":1,"stance":"反讽","strategy":"抖机灵","reason":"含 } 与 \\" 引号的依据"},{"i":2,"stance":"中';
  const { data } = extractJsonLenient(text);
  assert.equal(data.items.length, 1);
  assert.match(data.items[0].reason, /含 \} 与 " 引号/);
});

test('无法抢救时抛原始错误，调用方据此整体回退', () => {
  assert.throws(() => extractJsonLenient('{"items":[{"i":1,"sta'), /未闭合/);
});

// ---------- 逐条标注 ----------

const stub = (payload) => async () => (typeof payload === 'string' ? payload : JSON.stringify(payload));

test('AI 标注：合法标签全部采纳，来源标记为 deepseek，权重条固定为 1', async () => {
  const chat = stub({
    items: rows.map((_, i) => ({ i: i + 1, stance: '反对', strategy: '数据论证', confidence: 0.8, summary: '概括', reason: '依据' })),
  });
  const res = await aiAnnotateSpecies(question, rows, { chat, model: 'deepseek-flash' });
  assert.equal(res.aiCount, 3);
  assert.equal(res.repaired, false);
  for (const item of res.items) {
    assert.equal(item.annotationSource, aiSourceLabel('deepseek-flash'));
    assert.ok(isAiSource(item.annotationSource));
    // AI 判定没有「命中词累加分」，用假权重条会让判定依据变成装饰
    assert.equal(item.evidence.stance[0].weight, 1);
    assert.equal(item.aiReason, '依据');
  }
});

test('AI 标注：标签写进一句话仍能识别，完全自创则整条回退本地', async () => {
  const chat = stub({
    items: [
      { i: 1, stance: '立场：反对', strategy: '数据论证', confidence: 0.8 },
      { i: 2, stance: '无所谓', strategy: '讲道理', confidence: 0.9 },
      { i: 3, stance: '中立', strategy: '未识别', confidence: 0.2 },
    ],
  });
  const res = await aiAnnotateSpecies(question, rows, { chat, model: 'm' });
  assert.equal(res.aiCount, 2);
  assert.equal(res.items[0].stance, '反对');
  assert.equal(res.items[0].annotationSource, 'deepseek:m');
  // 半个 AI 标签比没有标签更危险：策略无效即整条回退，不允许半采纳
  assert.equal(res.items[1].annotationSource, 'local-heuristic');
  assert.equal(res.items[1].aiReason, null);
  // 「未识别」是合法枚举，必须被采纳而不是被当成缺失
  assert.equal(res.items[2].strategy, '未识别');
  assert.equal(res.items[2].annotationSource, 'deepseek:m');
});

test('AI 标注：截断后缺号的条目回退本地，已判定的条目保留 AI 来源', async () => {
  const text = '{"items":[{"i":1,"stance":"反对","strategy":"数据论证","confidence":0.8},{"i":2,"stance":"支持","strat';
  const res = await aiAnnotateSpecies(question, rows, { chat: stub(text), model: 'm' });
  assert.equal(res.repaired, true);
  assert.equal(res.aiCount, 1);
  assert.deepEqual(
    res.items.map((i) => i.annotationSource),
    ['deepseek:m', 'local-heuristic', 'local-heuristic'],
  );
});

test('AI 标注：一条都无效时返回 null，交调用方整体回退', async () => {
  assert.equal(await aiAnnotateSpecies(question, rows, { chat: stub({ items: [{ i: 1, stance: 'x', strategy: 'y' }] }), model: 'm' }), null);
});

test('AI 标注：输出缺少 items 数组时抛错（由调用方整批回退）', async () => {
  await assert.rejects(() => aiAnnotateSpecies(question, rows, { chat: stub('{"ok":true}'), model: 'm' }), /缺少 items/);
});

test('AI 标注：空样本不发起调用', async () => {
  let called = 0;
  const res = await aiAnnotateSpecies(question, [], {
    chat: async () => {
      called++;
      return '{}';
    },
  });
  assert.equal(res, null);
  assert.equal(called, 0);
});

// ---------- 问题类型 ----------

test('AI 问题类型：合法枚举采纳，自创类型返回 null 交本地句式规则', async () => {
  const hit = await aiClassifyQuestion(question, {
    chat: stub({ type: '判断型：judgement', confidence: 0.9, reason: '要求表态' }),
    model: 'm',
  });
  assert.equal(hit.type, 'judgement');
  assert.equal(hit.source, aiSourceLabel('m'));
  const miss = await aiClassifyQuestion(question, { chat: stub({ type: '随口聊聊', confidence: 0.9 }), model: 'm' });
  assert.equal(miss, null);
});
