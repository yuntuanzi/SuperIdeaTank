// AI 观点识别引擎（DeepSeek 驱动）
//
// 职责：把「逐条观点识别 / 问题类型识别 / 整缸派系归纳 / 放生后果推演 / 用户画像识别」
// 五件事交给真实大模型完成，同时用严格的 JSON 契约把模型输出挡在产品数据之外。
//
// 为什么不直接把模型返回的标签写进 species（三条不可越过的红线）：
//  1. **枚举必须封闭**：模型一旦输出「温和反对」「理性派」这类自创标签，前端的立场配色、
//     策略分布统计、生态报告全部失配。因此所有标签都要过白名单校验，逐字比对。
//  2. **必须可降级**：任何一次网络抖动、超时、JSON 破损都不能让整缸失败。识别失败时
//     逐条回退本地可解释标注器（annotator.js），并在 annotationSource 上如实标记来源差异。
//  3. **不许伪造**：模型没给出有效标签的条目走本地兜底，绝不拿默认值冒充 AI 判定。
//     「这条是 AI 判的」和「这条是本地模型兜的」在界面上必须能分辨。

import { aiChatText, aiModel, extractJsonLenient, hasAi } from './aiClient.js';
import { annotateOne } from './annotator.js';
import {
  STANCES,
  STRATEGIES,
  QUESTION_TYPES,
  buildAnnotateMessages,
  buildQuestionTypeMessages,
  buildExplainMessages,
  buildReleaseMessages,
  buildProfileMessages,
} from './prompts.js';

export function aiEnabled() {
  return hasAi();
}

// 标注来源标识：前端据此区分「AI 语义判定」与「本地词典判定」，是诚信展示的一部分。
export function aiSourceLabel(model) {
  return `deepseek:${model}`;
}

export function isAiSource(source) {
  return typeof source === 'string' && source.startsWith('deepseek:');
}

// ---------- 校验工具 ----------

function round2(value) {
  return Math.round(value * 100) / 100;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return round2(Math.min(1, Math.max(0, n)));
}

// 白名单校验。模型偶尔会把标签写进一句话里（「立场：反对」），
// 因此先精确匹配，再退化到「包含」匹配；两者都不成立才判定为无效。
// 注意必须先精确匹配：'未识别' 与其它六个策略互不包含，但 '支持' 是 '反对' 的子串反例
// 不存在，真正的风险是短标签被长文本误命中，所以「包含」只在没有精确命中时启用。
function pickEnum(value, allowed) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (allowed.includes(v)) return v;
  const hit = allowed.find((a) => v.includes(a));
  return hit ?? null;
}

function text(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

// ---------- 逐条观点物种识别 ----------

// 返回 { items, aiCount, model, repaired }；完全失败或一条都无效时返回 null，交由调用方回退本地标注。
export async function aiAnnotateSpecies(question, items, options = {}) {
  const { chat = aiChatText, model = aiModel('fast'), onReasoning, onProgress, signal } = options;
  if (!items.length) return null;

  const raw = await chat(buildAnnotateMessages(question, items), {
    model,
    json: true,
    // 标注是判别任务，不需要创作性；低温保证同一批输入标签稳定
    temperature: 0.15,
    // 10 条约需 1000 tokens 正文，思考峰值可到 1600（flash 实测），合计 8192 足够
    maxTokens: 8192,
    onReasoning,
    signal,
  });

  const { data, repaired } = extractJsonLenient(raw);
  const list = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : null;
  if (!list) throw new Error('AI 标注输出缺少 items 数组');

  // 按 i 对齐：模型返回顺序不可信，必须按显式序号归位；越界序号直接丢弃。
  // 没给出有效序号的条目（含截断后丢掉的那条）自然落进本地兜底，不会被误标。
  const byIndex = new Map();
  for (const entry of list) {
    const i = Number(entry?.i);
    if (!Number.isInteger(i) || i < 1 || i > items.length) continue;
    if (!byIndex.has(i)) byIndex.set(i, entry);
  }

  let aiCount = 0;
  const annotated = items.map((item, idx) => {
    const entry = byIndex.get(idx + 1);
    const stance = pickEnum(entry?.stance, STANCES);
    const strategy = pickEnum(entry?.strategy, STRATEGIES);
    // 任一维度无效 → 这一条整体回退本地标注。半个 AI 标签比没有标签更危险：
    // 它会以「AI 判定」的身份进入统计，却只经过一半校验。
    if (!stance || !strategy) return localFallback(question, item);
    aiCount += 1;
    const reason = text(entry?.reason, 60);
    return {
      ...item,
      stance,
      strategy,
      confidence: clamp01(entry?.confidence),
      summary: text(entry?.summary, 60) || text(item?.summary, 60),
      aiReason: reason || null,
      annotationSource: aiSourceLabel(model),
      // 权重固定为 1：AI 判定没有「命中词累加分」，用假权重条会让「判定依据」变成装饰。
      // 前端对 AI 来源改为纯文本展示依据，不再画权重条。
      evidence: {
        stance: [{ term: reason || '模型语义判定', weight: 1 }],
        strategy: [{ term: reason || '模型语义判定', weight: 1 }],
      },
    };
  });

  if (aiCount === 0) return null;
  onProgress?.({ aiCount, total: items.length });
  // repaired 如实上报：输出被截断时前端要能说明「部分条目回退本地」的原因，
  // 而不是让用户以为是模型判错了。
  return { items: annotated, aiCount, localCount: items.length - aiCount, model, repaired: Boolean(repaired) };
}

function localFallback(question, item) {
  const local = annotateOne(question, item);
  return {
    ...item,
    ...local,
    summary: text(item?.summary, 60),
    annotationSource: 'local-heuristic',
    aiReason: null,
  };
}

// ---------- 问题类型识别 ----------

// 问题类型决定「色轴用立场还是用策略」以及告警措辞，判错会让整缸配色讲错故事，
// 因此这里也用 AI 判；失败则返回 null，由调用方回退本地句式规则。
export async function aiClassifyQuestion(question, options = {}) {
  const { chat = aiChatText, model = aiModel('fast'), signal } = options;
  const raw = await chat(buildQuestionTypeMessages(question), {
    model,
    json: true,
    temperature: 0,
    // 输出只有一个短 JSON，但推理模型的思考同样吃额度：给 4096（下限）留足余量
    maxTokens: 4096,
    signal,
  });
  const { data } = extractJsonLenient(raw);
  const type = pickEnum(data?.type, QUESTION_TYPES);
  if (!type) return null;
  return { type, confidence: clamp01(data?.confidence), reason: text(data?.reason, 60), source: aiSourceLabel(model) };
}

// ---------- 整缸派系归纳 ----------

export async function aiExplainFactions(question, species, options = {}) {
  const { chat = aiChatText, model = aiModel('pro'), onReasoning, signal } = options;
  const raw = await chat(buildExplainMessages(question, species), {
    model,
    json: true,
    temperature: 0.35,
    // pro 的思考峰值实测 ≈5800 tokens，正文 ≈600，4096 会偶发把正文挤空
    maxTokens: 8192,
    onReasoning,
    signal,
  });
  const { data, repaired } = extractJsonLenient(raw);
  const factions = (Array.isArray(data?.factions) ? data.factions : [])
    .map((f) => ({
      name: text(f?.name, 40),
      claim: text(f?.claim, 120),
      persuasion: text(f?.persuasion, 80),
    }))
    .filter((f) => f.name);
  return {
    // 原文独立保留：结构解析失败时前端仍能展示已取得的解说，不丢内容
    narrative: raw,
    factions: factions.length ? factions : null,
    dominant: data?.dominant ? text(data.dominant, 200) : null,
    source: aiSourceLabel(model),
    repaired: Boolean(repaired),
  };
}

// ---------- 放生后果推演 ----------

export async function aiReleaseInsight(question, draft, species, rule, options = {}) {
  const { chat = aiChatText, model = aiModel('pro'), signal } = options;
  const raw = await chat(buildReleaseMessages(question, draft, species, rule), {
    model,
    json: true,
    temperature: 0.5,
    // 点评 + 两组评论列表，正文较长，按思考峰值 + 正文给足
    maxTokens: 8192,
    signal,
  });
  const { data } = extractJsonLenient(raw);
  const toList = (value, limit, maxItems) =>
    (Array.isArray(value) ? value : [])
      .map((t) => text(t, limit))
      .filter(Boolean)
      .slice(0, maxItems);
  return {
    comment: text(data?.comment, 400),
    rebuttals: toList(data?.rebuttals, 60, 4),
    attractComments: toList(data?.attractComments, 40, 5),
    source: aiSourceLabel(model),
  };
}

// ---------- 用户画像识别 ----------

export async function aiProfileContents(contents, options = {}) {
  const { chat = aiChatText, model = aiModel('fast'), signal } = options;
  const raw = await chat(buildProfileMessages(contents), {
    model,
    json: true,
    temperature: 0.2,
    // 逐条标注 12 条内容的正文可达 1200 tokens，加上思考峰值
    maxTokens: 8192,
    signal,
  });
  const { data } = extractJsonLenient(raw);
  const list = Array.isArray(data?.items) ? data.items : [];
  const byIndex = new Map();
  for (const entry of list) {
    const i = Number(entry?.i);
    if (!Number.isInteger(i) || i < 1 || i > contents.length) continue;
    if (!byIndex.has(i)) byIndex.set(i, entry);
  }
  const labels = contents.map((_, idx) => {
    const entry = byIndex.get(idx + 1);
    return {
      stance: pickEnum(entry?.stance, STANCES),
      strategy: pickEnum(entry?.strategy, STRATEGIES),
      confidence: clamp01(entry?.confidence),
    };
  });
  const identified = labels.filter((l) => l.stance && l.strategy).length;
  if (!identified) return null;
  return {
    labels,
    identified,
    dominantStrategy: pickEnum(data?.dominantStrategy, STRATEGIES),
    dominantStance: pickEnum(data?.dominantStance, STANCES),
    conclusion: text(data?.conclusion, 80),
    source: aiSourceLabel(model),
  };
}
