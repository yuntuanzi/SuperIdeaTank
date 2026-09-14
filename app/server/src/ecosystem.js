// 生态缸构建与放生分析管线
//
// 标注分工（2026-09-15 换装 DeepSeek 后的形态）：
//  - 逐条观点识别 → DeepSeek（prompts.js 定义严格 JSON 契约），失败回退本地可解释词典标注器；
//  - 问题类型识别 → DeepSeek，失败回退本地句式规则（annotator.classifyQuestion）；
//  - 整缸派系归纳 → DeepSeek（deepseek-v4-pro）；
//  - 存活概率 / 压制来源 / 风险 / 杂交建议 → 规则模型（ruleModel.js），AI 一律不参与。
// 无论走哪条路径，返回契约完全一致，前端不需要猜测字段缺失是否代表 AI 出错。

import { searchZhihu, globalSearch, fetchQuestionAnswers } from './zhihu.js';
import { survivalRule } from './ruleModel.js';
import { annotateAll, annotateOne, classifyQuestion as localClassifyQuestion } from './annotator.js';
import { aiChatText, aiModel, extractJson, extractJsonLenient, hasAi } from './aiClient.js';
import { aiAnnotateSpecies, aiClassifyQuestion, aiSourceLabel, isAiSource } from './aiAnnotator.js';
import { STANCES, STRATEGIES, buildExplainMessages, buildReleaseMessages } from './prompts.js';

export { STANCES, STRATEGIES, extractJson };

// ---------- 进度上报 ----------

// 进度回调是「把思考过程展示给用户」的唯一通道。它绝不能因为一个订阅者的异常
// 而中断整条构建链 —— 观感问题不该升级成可用性问题。
function emit(options, event) {
  try {
    options?.onEvent?.(event);
  } catch {
    /* 订阅者异常不影响构建 */
  }
}

// ---------- 工具 ----------

// 标题与查询词的 2-gram 重现率，用于过滤跑题搜索结果
export function relevanceScore(title, query) {
  const grams = (s) => {
    const t = s.replace(/\s+/g, '');
    const set = new Set();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const a = grams(query);
  const b = grams(title || '');
  if (a.size === 0) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / a.size;
}

// ---------- 生态缸构建 ----------

// 捕获 question ID：直接用于与 global_search 结果的 qid 精确对齐
const QUESTION_URL_RE = /^https?:\/\/(?:www\.)?zhihu\.com\/question\/(\d+)\/?$/;
// 从任意知乎内容 URL 中取出 question / answer 标识（global_search 与 question_answers 共用）。
// URL 可能带 ?utm_* 查询串，因此数字后必须允许非数字或串尾作为边界。
const QUESTION_ID_IN_URL_RE = /\/question\/(\d+)(?:\D|$)/;
const ANSWER_ID_IN_URL_RE = /\/answer\/(\d+)(?:\D|$)/;

// 注意：global_search 返回的 Url 带 utm 查询串（?utm_medium=openapi_platform&utm_source=...），
// 因此捕获组后必须允许 \D 或串尾，否则 /answer/<aid>?... 会匹配失败 —— 这是早期富化 0 命中的直接原因。
function extractQuestionId(url) {
  return String(url || '').match(QUESTION_ID_IN_URL_RE)?.[1] ?? null;
}

function extractAnswerId(url) {
  return String(url || '').match(ANSWER_ID_IN_URL_RE)?.[1] ?? null;
}

// 归一化正文：去空白与常见标点（保留给搜索相关性等文本处理使用）
// 合并同一问题的两批独立抽样，产出更大的物种池。
//
// 为什么不是「关联」而是「合并」：实测 question_answers 与 global_search 返回的
// 回答集合完全不相交（交集 0/10），它们是同一问题的两份独立抽样而非同一内容的两种视图。
// 因此不能指望用一边的字段去补另一边的行，只能把两边都作为物种收进来：
//   - question_answers 侧：回答成规模，但无赞同数 → votes=null
//   - global_search 侧：带真实 VoteUpCount，但条数少 → votes 为真实值
// 万一某条确实同 id（未来端点行为变化），保留赞同数更丰富的一侧，避免重复物种。
export function mergeSameQuestion(answersItems = [], sameQuestionItems = []) {
  const toRow = (it, fromGlobal) => ({
    id: String(it.id),
    excerpt: it.excerpt || '',
    author: it.author || '知乎用户',
    badgeText: it.badgeText || '',
    authority: it.authority || 1,
    votes: fromGlobal ? (it.votes ?? 0) : null,
    comments: fromGlobal ? it.comments ?? 0 : 0,
    editTime: fromGlobal ? it.editTime ?? 0 : 0,
    url: it.url,
    featuredComments: fromGlobal ? it.featuredComments || [] : [],
    _aid: extractAnswerId(it.url) || String(it.id),
  });

  const merged = new Map();
  for (const it of answersItems) {
    const row = toRow(it, false);
    merged.set(row._aid, row);
  }
  for (const it of sameQuestionItems) {
    const row = toRow(it, true);
    const prev = merged.get(row._aid);
    // 同 id 时以带真实赞同数/更长正文的一侧为准
    if (!prev || prev.votes === null || row.excerpt.length > prev.excerpt.length) {
      merged.set(row._aid, { ...row, id: prev?.id ?? row.id });
    }
  }
  return [...merged.values()].map(({ _aid, ...rest }) => rest);
}

// 把来源行统一成物种骨架（未带标签）。两条采集通道共用，避免字段漂移。
function toSpeciesRow(question, row) {
  return {
    id: String(row.id),
    title: row.title || question,
    // 正文裁到 300 字：保证标注证据可在展示文本内找到
    excerpt: (row.excerpt || '').slice(0, 300),
    author: row.author || '知乎用户',
    badgeText: row.badgeText || '',
    authority: row.authority || 1,
    votes: row.votes ?? null, // null = 无公开赞同数，能量按热序近似
    enriched: row.votes !== null && row.votes !== undefined,
    comments: row.comments || 0,
    editTime: row.editTime || 0,
    url: row.url,
    featuredComments: row.featuredComments || [],
    heatRank: 0,
  };
}

// 热序：有真实赞同数的一律排在无数据之前（降序），都无数据则保持来源顺序。
// 用来源下标而非 votes??0 做次级键，是为了让「没有赞同数」不被当成「赞同数=0」，
// 否则同题的零赞同回答会和无数据回答混在一起，排序不再可解释。
function rankByHeat(species, indexOf) {
  const ranked = species
    .map((s, index) => ({ s, index }))
    .sort((a, b) => {
      const av = a.s.votes;
      const bv = b.s.votes;
      if (av !== null && bv !== null) return bv - av;
      if (av !== null) return -1;
      if (bv !== null) return 1;
      return (indexOf ? indexOf(a.s, a.index) : a.index) - (indexOf ? indexOf(b.s, b.index) : b.index);
    });
  ranked.forEach(({ s }, i) => {
    s.heatRank = species.length - i;
  });
  return ranked.map(({ s }) => s);
}

// 双通道数据源：
//  A) 问题 URL → question_answers 直取该问题下的回答（2026-09-13 实测可用），
//     再由 global_search 按 qid 精确匹配补充赞同数等字段
//  B) 仅标题 → 搜索汇聚相关回答样本（相关性过滤）
export async function buildEcosystem(question, questionUrl, options = {}) {
  // 数据获取与 AI 能力都提供替身入口，测试才能覆盖整个构建流程而不消耗任何上游额度。
  const {
    search = searchZhihu,
    global = globalSearch,
    answers = fetchQuestionAnswers,
    // 未配置 DeepSeek 时默认不启用 AI：测试环境天然无密钥，绝不会误打真实网络。
    annotate = hasAi() ? aiAnnotateSpecies : null,
    classify = hasAi() ? aiClassifyQuestion : null,
  } = options;

  // 关键：把解构出来的默认实现**回填进 options**。
  // 下游 annotateSpeciesStage 只从 options.annotate 取实现，而解构默认值只存在于
  // 局部变量里、不会写回原对象 —— 不回填会让 AI 标注被静默跳过，
  // 表现为「questionType 走了 AI 而物种标注全部回退本地」（e2e 实测 0/7 的根因）。
  const ctx = { ...options, annotate, classify };
  const trimmedUrl = typeof questionUrl === 'string' ? questionUrl.trim() : '';

  // 先抓取知乎问题与回答，再启动 AI。抓取阶段不应提前消耗 AI 额度，
  // 也避免数据尚未准备好时 AI 先行失败。

  if (trimmedUrl && QUESTION_URL_RE.test(trimmedUrl)) {
    emit(ctx, { type: 'stage', key: 'fetch', label: '直取该问题下的回答样本', state: 'start' });
    const { items } = await answers(trimmedUrl, 0, 10);
    emit(ctx, { type: 'log', text: `question_answers 返回 ${items.length} 条回答` });
    if (items.length === 0) {
      // 空缸同样返回完整契约，前端不需要猜测字段缺失是否代表 AI 出错。
      return completeEcosystem(
        { question, questionUrl: trimmedUrl, source: 'live', dataSource: 'question_answers', createdAt: Date.now(), species: [], note: '该问题下暂未获取到回答' },
        { ...ctx },
      );
    }

    // 富化：question_answers 不返回赞同数，改用 global_search 按问题 ID 精确匹配。
    //
    // 历史教训（2026-09-15 实测推翻旧方案）：旧实现用 zhihu_search 的摘要做 LCS≥20
    // 连续汉字匹配，但实测两个端点返回的回答集合**完全不相交**（交集 0/10，
    // 逐条 LCS 最高仅 5 字符），因为 zhihu_search 是「按关键词全站检索」，
    // 与该问题没有任何绑定关系，所以那条链路无论怎么调参都不可能命中。
    //
    // 二次实测（同日）：换成 global_search 后，集合同样**不相交**（交集仍为 0/10）。
    // 结论：question_answers 与 global_search 是同一问题的**两份独立抽样**，
    // 不是同一批内容的两种视图。因此「按 answer id 关联赞同数」在任何端点组合下
    // 都不可能成立 —— 这是数据源语义决定的，不是实现问题。
    //
    // 正解（见下方 mergeSameQuestion）：把两批样本**合并**成一个更大的物种池 ——
    // question_answers 贡献成规模回答（无赞同数），global_search 贡献带真实赞同数的
    // 同题回答。命中不了的条目如实保留 votes=null，不伪造热度。
    let sameQuestionItems = [];
    try {
      emit(ctx, { type: 'stage', key: 'enrich', label: '全网搜索补齐赞同数', state: 'start' });
      const qid = trimmedUrl.match(QUESTION_URL_RE)?.[1] ?? null;
      const found = await global(question, 20);
      sameQuestionItems = qid ? found.filter((it) => extractQuestionId(it.url) === qid) : [];
      emit(ctx, { type: 'log', text: `同题命中 ${sameQuestionItems.length} 条带赞同数的回答` });
    } catch {
      // global_search 额度耗尽或失败 → 仅用 question_answers 基础字段，能量按热序近似
      emit(ctx, { type: 'log', text: '赞同数补齐失败，能量改用热序近似' });
    }
    // 合并两批抽样。question_answers 提供成规模回答（无赞同数），
    // global_search 提供带真实赞同数的同题回答；同 answer id 时以带赞同数的一侧为准。
    const merged = mergeSameQuestion(items, sameQuestionItems);

    const rows = merged.map((it) => toSpeciesRow(question, it));
    const { items: labeled, annotationWarning, annotationSource, aiCount } = await annotateSpeciesStage(question, rows, ctx);
    const species = rankByHeat(labeled);
    const enrichedCount = species.filter((s) => s.enriched).length;
    emit(ctx, {
      type: 'stage',
      key: 'annotate',
      label: aiCount === species.length ? 'AI 逐条识别观点物种' : '识别观点物种',
      state: 'done',
      detail: aiCount === species.length ? `${aiCount} 条由 AI 判定` : `${aiCount}/${species.length} 条由 AI 判定，其余回退本地模型`,
    });
    return completeEcosystem({
      question,
      questionUrl: trimmedUrl,
      source: 'live',
      dataSource: 'question_answers',
      createdAt: Date.now(),
      species,
      annotationWarning,
      annotationSource,
      // 如实告知富化覆盖率与物种池构成：有多少条回答拿到了真实赞同数
      enrichment: {
        enriched: enrichedCount,
        total: species.length,
        fromAnswers: items.length,
        fromGlobalSearch: sameQuestionItems.length,
        strategy: 'merge-two-samples',
      },
    }, { ...ctx });
  }

  // 通道 B：关键词搜索汇聚
  emit(ctx, { type: 'stage', key: 'fetch', label: '检索该问题下的相关回答样本', state: 'start' });
  const raw = await search(question, 10);

  // 相关性过滤：2-gram 重现率 >= 0.25 视为同题；不足 3 条时放宽取前 6
  const scored = raw
    .map((it) => ({ ...it, relevance: relevanceScore(it.title, question) }))
    .sort((x, y) => y.relevance - x.relevance);
  let picked = scored.filter((it) => it.relevance >= 0.25);
  if (picked.length < 3) picked = scored.slice(0, 6);

  if (picked.length === 0) {
    // 搜索失败与搜索成功但无结果不同，后者可以安全返回一个完整的空缸。
    return completeEcosystem(
      { question, source: 'live', dataSource: 'search', createdAt: Date.now(), species: [], note: '搜索未返回可用回答' },
      { ...ctx },
    );
  }
  emit(ctx, { type: 'log', text: `相关性过滤后保留 ${picked.length} 条样本` });

  const rows = picked.map((it) => toSpeciesRow(question, it));
  const { items: labeled, annotationWarning, annotationSource, aiCount } = await annotateSpeciesStage(question, rows, ctx);
  const species = rankByHeat(labeled);
  emit(ctx, {
    type: 'stage',
    key: 'annotate',
    label: aiCount === species.length ? 'AI 逐条识别观点物种' : '识别观点物种',
    state: 'done',
    detail: aiCount === species.length ? `${aiCount} 条由 AI 判定` : `${aiCount}/${species.length} 条由 AI 判定，其余回退本地模型`,
  });

  return completeEcosystem({
    question,
    source: 'live',
    dataSource: 'search',
    createdAt: Date.now(),
    species,
    annotationWarning,
    annotationSource,
  }, { ...ctx });
}

// 标注阶段：AI 优先，失败逐条回退本地。
// 返回的 annotationSource 是「这批物种主要来自谁」，供前端在证据块上如实标注。
async function annotateSpeciesStage(question, rows, options) {
  const { annotate: aiAnnotate } = options;
  if (aiAnnotate && rows.length) {
    emit(options, { type: 'stage', key: 'annotate', label: 'AI 逐条识别观点物种', state: 'start', detail: `共 ${rows.length} 条样本` });
    try {
      const result = await aiAnnotate(question, rows, {
        onReasoning: (text) => emit(options, { type: 'reasoning', text, stage: 'annotate' }),
        signal: options.signal,
      });
      if (result?.items?.length) {
        // 输出被 max_tokens 截断时如实说明：让「为什么有几条回退本地」有据可查，
        // 而不是让用户以为是模型判错了。
        if (result.repaired) {
          emit(options, { type: 'log', text: '模型输出被输出额度截断，已保留完整判定的条目，其余回退本地模型' });
        }
        return {
          items: result.items,
          annotationWarning: distributionWarning(result.items),
          // 与物种级 annotationSource 保持同一种写法（deepseek:<model>）：
          // 前端用同一个前缀判断「这批标签是不是 AI 判的」，两种写法会让散装判断失效。
          annotationSource: aiSourceLabel(result.model),
          aiCount: result.aiCount,
        };
      }
      emit(options, { type: 'log', text: 'AI 未返回有效标签，整批回退本地可解释标注' });
    } catch (e) {
      emit(options, { type: 'log', text: `AI 识别失败，回退本地可解释标注：${e.message}` });
    }
  }
  const local = annotateAll(question, rows);
  return {
    items: local.items.map((item) => ({ ...item, summary: item.summary || '', annotationSource: 'local-heuristic' })),
    annotationWarning: local.annotationWarning,
    annotationSource: 'local-heuristic',
    aiCount: 0,
  };
}

// 本地标注器的分布告警：AI 同样会整批坍缩，两条路径共用同一套阈值。
function distributionWarning(items) {
  const collapsed = (key) => {
    if (!items.length) return false;
    const counts = new Map();
    for (const item of items) counts.set(item[key], (counts.get(item[key]) || 0) + 1);
    return Math.max(...counts.values()) / items.length >= 0.8;
  };
  if (!items.length) return null;
  if (collapsed('stance')) return '立场特征稀疏，多数物种落入同一类，标注可信度低';
  const unrecognized = items.filter((item) => item.strategy === '未识别').length;
  if (unrecognized / items.length >= 0.5) return '多数回答的说服方式未能识别，策略标注仅供参考';
  if (collapsed('strategy')) return '策略特征稀疏，多数物种落入同一类，标注可信度低';
  return null;
}

// 问题类型：AI 优先，失败回退本地句式规则。前端据此决定色轴用立场还是策略。
async function resolveQuestionType(question, classify, options) {
  const local = localClassifyQuestion(question);
  if (!classify) return { type: local.type, matched: local.matched, source: 'local-rule' };
  try {
    const ai = await classify(question, { signal: options.signal });
    if (ai?.type) return { type: ai.type, matched: [], reason: ai.reason, source: ai.source };
  } catch (e) {
    emit(options, { type: 'log', text: `问题类型 AI 判定失败，回退句式规则：${e.message}` });
  }
  return { type: local.type, matched: local.matched, source: 'local-rule' };
}

// 解析只生成附加视图；格式漂移时不能丢掉已经取得的叙事原文。
export function parseAiNarrative(text) {
  const empty = { aiFactions: null, aiDominant: null };
  if (typeof text !== 'string' || !text.trim()) return empty;
  // 部分留证文本保留字面量换行，只在解析副本展开，不改变 aiNarrative。
  const normalized = text.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  // 附录 A 的已验证 prompt 产出的标题允许“##一、”无空格写法，[ \t]* 容忍这类轻微排版漂移。
  const sections = [...normalized.matchAll(/^##[ \t]*([^\n]+)\n?/gm)];
  const factions = [];
  let dominant = null;
  for (let i = 0; i < sections.length; i++) {
    const heading = sections[i][1].trim();
    const body = normalized.slice(sections[i].index + sections[i][0].length, sections[i + 1]?.index ?? normalized.length).trim();
    // 优势结论不是一个派系，独立提取避免它被计入派系数量。
    if (/^(?:哪派最占上风|谁最占上风|占上风)/.test(heading)) {
      dominant = body.slice(0, 200) || null;
      continue;
    }
    const title = heading.match(/^(?:[一二三四五六七八九十]+、|\d+[.、])\s*(.+)$/);
    if (!title) continue;
    const name = title[1].split(/["“「]/)[0].replace(/[：:\s]+$/, '').trim();
    if (!name) continue;
    // 字段内部可以有加粗短语，结束边界必须是段落或下一个完整字段标签。
    const field = (label, limit) => {
      const match = body.match(new RegExp('\\*\\*' + label + '\\*\\*[：:][ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*\\n|\\n[ \\t]*\\*\\*(?:代表观点|说服方式)\\*\\*[：:]|$)'));
      return match ? match[1].trim().slice(0, limit) : '';
    };
    factions.push({ name, claim: field('代表观点', 120), persuasion: field('说服方式', 80) });
  }
  return { aiFactions: factions.length ? factions : null, aiDominant: dominant };
}

// JSON 优先、Markdown 兜底：新调用一律要求 JSON，但历史缓存里的
// 直答 Markdown 解说必须继续可读 —— 那是一次性烧额度换来的留证，不能因为换装就丢。
//
// 用宽容解析（extractJsonLenient）：模型输出被输出额度截断时，只要 factions 数组
// 已经写完整就仍能取出派系；严格解析会直接把它判死并退到 Markdown 兜底，
// 表现为「AI 调用成功但派系为空」（e2e 实测到的现象）。
export function parseExplainOutput(text) {
  try {
    const { data } = extractJsonLenient(text);
    if (data && typeof data === 'object' && Array.isArray(data.factions)) {
      const factions = data.factions
        .map((f) => ({
          name: String(f?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
          claim: String(f?.claim ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
          persuasion: String(f?.persuasion ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
        }))
        .filter((f) => f.name);
      if (factions.length) {
        return { aiFactions: factions, aiDominant: data.dominant ? String(data.dominant).slice(0, 200) : null };
      }
    }
  } catch {
    /* 不是 JSON → 走 Markdown 兜底 */
  }
  return parseAiNarrative(text);
}

// 单次失败只影响可选叙事，本地标注和模板已经足够组成可用生态缸。
export async function explainEcosystem(question, species, options = {}) {
  const empty = { aiNarrative: null, aiNarrativeSource: null, aiFactions: null, aiDominant: null };
  if (!species.length || options.includeAi === false) return empty;
  const { chat = aiChatText, model = aiModel('pro'), signal } = options;
  try {
    emit(options, { type: 'stage', key: 'explain', label: '归纳整缸派系与优势方', state: 'start' });
    const text = await chat(buildExplainMessages(question, species), {
      model,
      json: true,
      temperature: 0.35,
      // pro 的思考峰值实测 ≈5800 tokens：4096 会偶发把正文挤出额度（content 为空）
      maxTokens: 8192,
      onReasoning: (t) => emit(options, { type: 'reasoning', text: t, stage: 'explain' }),
      signal,
    });
    if (typeof text !== 'string' || !text.trim()) throw new Error('AI 返回缺少 content');
    return { aiNarrative: text, aiNarrativeSource: aiSourceLabel(model), ...parseExplainOutput(text) };
  } catch (error) {
    emit(options, { type: 'log', text: `整缸解说失败：${error instanceof Error ? error.message : '未知错误'}` });
    return { ...empty, aiNarrativeError: error instanceof Error ? error.message : 'AI 解说失败' };
  }
}

// 两条采集通道共用收尾，避免 AI 出错时遗漏本地叙事或空值字段。
async function completeEcosystem(tank, options) {
  const rest = options;
  // 数据已抓取并完成本地样本整理后，才在这里顺序启动 AI。
  const qtype = await resolveQuestionType(tank.question, rest.classify, rest);
  const ai = await explainEcosystem(tank.question, tank.species, rest);
  emit(rest, { type: 'stage', key: 'explain', label: '归纳整缸派系与优势方', state: 'done' });
  return {
    ...tank,
    questionType: qtype.type,
    questionTypeSource: qtype.source,
    narrative: buildNarrative(tank.question, tank.species, qtype),
    annotationWarning: tank.annotationWarning ?? null,
    ...ai,
  };
}

// 旧缓存仍可能是全灰物种；仅在内存重标，不联网，也不改写用户的原始留证文件。
export function refreshLocalAnnotations(tank) {
  if (tank.source === 'demo') return tank;
  const { items: species, annotationWarning } = annotateAll(tank.question, tank.species || []);
  const aiNarrative = typeof tank.aiNarrative === 'string' && tank.aiNarrative.trim() ? tank.aiNarrative : null;
  return {
    ...tank,
    species: species.map((item) => ({ ...item, summary: item.summary || '', annotationSource: item.annotationSource || 'local-heuristic' })),
    annotationWarning,
    narrative: buildNarrative(tank.question, species),
    aiNarrative,
    aiNarrativeSource: aiNarrative ? tank.aiNarrativeSource || null : null,
    ...parseExplainOutput(aiNarrative),
  };
}

function buildNarrative(question, species, qtype) {
  // 生态剖面叙事用本地模板生成（零 AI 消耗），数据全部来自真实标注
  if (!species.length) return '';
  const byStance = {};
  for (const s of species) byStance[s.stance] = (byStance[s.stance] || 0) + 1;
  const dominant = Object.entries(byStance).sort((a, b) => b[1] - a[1])[0];
  const top = [...species].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))[0];
  const byStrategy = {};
  for (const s of species) byStrategy[s.strategy] = (byStrategy[s.strategy] || 0) + 1;
  const bestStrategy = Object.entries(byStrategy).sort((a, b) => b[1] - a[1])[0];
  const typeNote = qtype?.type === 'why' ? '这是归因型提问 —— 回答以解释为主，立场维度参考价值有限。' : qtype?.type === 'howto' ? '这是求解型提问 —— 回答以给方法为主，立场维度参考价值有限。' : '';
  return [
    `「${question}」的生态缸中采集到 ${species.length} 个观点物种。`,
    typeNote,
    dominant ? `优势立场是「${dominant[0]}」（${dominant[1]} 个物种）；` : '',
    top ? `当前能量最高的是「${top.strategy}」型回答（${top.votes ?? '热序'} 赞同）${top.summary ? `：${top.summary}。` : '。'}` : '',
    bestStrategy ? `本问题下最常见的生存策略是「${bestStrategy[0]}」——在这个生态位，它比其他策略更容易存活。` : '',
  ].join('');
}

// ---------- 放生实验 ----------

export async function analyzeRelease(question, species, draft, options = {}) {
  // 数值模型只依赖本地标签，避免 AI 成败让同一草稿的规则概率漂移。
  const annotation = annotateOne(question, { excerpt: draft });
  const rule = survivalRule(species, annotation);
  const { chat = aiChatText, model = aiModel('pro'), signal } = options;
  let aiComment = null;
  let rebuttals = [];
  let attractComments = [];
  let aiInsightSource = null;
  if (options.includeAi !== false) {
    // 点评即便碰巧含 JSON，也不能覆盖概率、风险或建议；草稿截断用于控制问答长度。
    try {
      emit(options, { type: 'stage', key: 'release', label: '推演这条回答进入讨论后的命运', state: 'start' });
      const raw = await chat(buildReleaseMessages(question, draft, species, rule), {
        model,
        json: true,
        temperature: 0.5,
        maxTokens: 8192,
        signal,
      });
      const { data: parsed } = extractJsonLenient(raw);
      const toList = (value, limit, maxItems) =>
        (Array.isArray(value) ? value : [])
          .map((t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, limit))
          .filter(Boolean)
          .slice(0, maxItems);
      if (typeof parsed?.comment === 'string' && parsed.comment.trim()) {
        aiComment = parsed.comment.trim().slice(0, 400);
        aiInsightSource = aiSourceLabel(model);
      }
      rebuttals = toList(parsed?.rebuttals, 60, 4);
      attractComments = toList(parsed?.attractComments, 40, 5);
    } catch {
      // 本地分析已经完成，点评失败不应阻断放生实验。
    }
  }
  return {
    stance: annotation.stance,
    strategy: annotation.strategy,
    summary: draft.slice(0, 30),
    survivalProbability: rule.probability,
    ruleProbability: rule.probability,
    aiProbability: null,
    suppressedBy: rule.suppressedBy,
    risks: rule.risks,
    rebuttals,
    attractComments,
    hybridAdvice: rule.advice,
    narrative: rule.narrative,
    aiComment,
    aiInsightSource,
    analysisSource: aiComment === null ? 'rule+local' : 'rule+local+ai',
    simulatedAt: Date.now(),
  };
}

// 透明存活概率模型见 ruleModel.js（公式在 UI 中展示）。
export { isAiSource };
