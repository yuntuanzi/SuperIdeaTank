// DeepSeek 官方客户端（OpenAI 兼容协议）
//
// 为什么换掉知乎直答：直答是 RAG 问答产品而非指令执行器，实测 system prompt 会被
// 丢弃、返回 1500 字知乎风格长文（见 docs/DEVELOPMENT.md 0.5 节）。DeepSeek 是通用
// 指令模型，能稳定遵守「只输出 JSON」的契约 —— 这是本项目把「逐条观点识别」从
// 本地词典搬回真实模型的前提。
//
// 实测要点（2026-09-15，Key 属于已开通账号）：
//  1. 可用模型仅两个：deepseek-flash（快）、deepseek-v4-pro（深）。二者均为
//     **推理模型**：先吐 reasoning_content（思考过程），再吐 content（最终正文）。
//  2. reasoning 计入 completion_tokens。max_tokens 给 400 时会被思考全部吃光，
//     content 为空字符串 —— 默认值必须给足（DEFAULT_MAX_TOKENS）。
//  3. response_format:{type:'json_object'} 被接受；官方要求提示词里出现 "json" 字样，
//     因此系统提示词中必须显式包含该词，否则可能被拒绝。
//  4. 流式下首个 reasoning 增量约 0.6s 到达、content 约 4.5s 到达（单条标注量级），
//     这正是「等待中把思考过程展示给用户」的交互窗口。
//
// ⚠️ 额度预算（2026-09-15 实测，踩过坑）：
//   reasoning 与 content **共享同一个 max_tokens 预算**。给 4096 时，
//   同一段提示词时而完整返回、时而思考把额度吃光导致 content 为空 ——
//   是偶发故障而非确定性错误，比崩溃更难排查。实测一次「整缸派系归纳」的
//   思考峰值约 17000 字（≈5800 tokens），正文另需 ≈600 tokens。
//   因此 DEFAULT_MAX_TOKENS 不能按「正文长度」估，必须按「思考峰值 + 正文」估。
//
// 安全：密钥只从服务端环境读取，绝不出现在前端、日志、响应体或仓库中。

import { aiCacheDedup, aiCacheGet, aiCacheKey, aiCacheSet } from './aiCache.js';

const DEFAULT_BASE = 'https://api.deepseek.com';
// 按「思考峰值 + 正文」估算：deepseek-v4-pro 的思考可达 6000 tokens，长正文再留 2000。
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 90000;

// 配置一律延迟读取：Docker 用 --env-file 注入真实进程环境，本地由 loadEnv.js 解析 .env，
// 两者都在模块求值之后才可能就绪，顶层缓存会读到旧值。
export function aiConfig() {
  const key = process.env.DEEPSEEK_API_KEY || '';
  return {
    configured: Boolean(key),
    base: (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''),
    fast: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    pro: process.env.DEEPSEEK_MODEL_PRO || 'deepseek-v4-pro',
  };
}

export function hasAi() {
  return aiConfig().configured;
}

export function aiModel(tier = 'fast') {
  const cfg = aiConfig();
  return tier === 'pro' ? cfg.pro : cfg.fast;
}

// ---------- 计量（供 /api/status 暴露可观测性，不含任何敏感信息） ----------

const usage = { calls: 0, ok: 0, failed: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

export function aiUsage() {
  return { ...usage };
}

export function resetAiUsage() {
  usage.calls = 0;
  usage.ok = 0;
  usage.failed = 0;
  usage.promptTokens = 0;
  usage.completionTokens = 0;
  usage.reasoningTokens = 0;
}

function recordUsage(u) {
  if (!u) return;
  usage.promptTokens += Number(u.prompt_tokens) || 0;
  usage.completionTokens += Number(u.completion_tokens) || 0;
  usage.reasoningTokens += Number(u.completion_tokens_details?.reasoning_tokens) || 0;
}

// ---------- JSON 抽取 ----------

// 扫描出第一个平衡的 JSON 结构，返回切片位置（end = -1 表示未闭合/被截断）。
// 手写扫描而非正则：模型正文里会出现字符串内部的括号与转义引号，
// 只有跟踪「是否处于字符串内」才能判断它们是否属于结构层。
function scanBalanced(text) {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  const open = cleaned[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { cleaned, start, end: i + 1 };
    }
  }
  return { cleaned, start, end: -1 };
}

// 从模型输出中取出第一个平衡的 JSON 结构。
// 正文理论上就是纯 JSON，但推理模型偶发会在前后带上零散说明或 ```json 围栏；
// 这里做宽容抽取，取不到才判定为格式失败。**严格语义**：不闭合一律报错。
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('输出为空');
  const found = scanBalanced(text);
  if (!found) throw new Error('输出中未找到 JSON');
  if (found.end === -1) throw new Error('JSON 未闭合');
  return JSON.parse(found.cleaned.slice(found.start, found.end));
}

// 抢救被 max_tokens 截断的 JSON。
//
// 为什么需要它：推理模型的思考与正文共享额度，额度耗尽时正文会停在半个字段上
// （实测同一提示词在 4096 下时而完整时而为空）。把这种输出整批判死代价太大 ——
// 模型其实已经把前面几条判完了。
//
// 原则：只保留**模型完整产出**的部分。做法是记录所有「某个容器刚闭合」的位置，
// 从后往前截到该位置并补齐缺失的闭合符，取第一个能解析成功的结果。
// 丢掉的是没写完的尾巴，不会凭空造出任何字段 —— 与「不许伪造标签」的红线一致。
function repairTruncatedJson(text, maxAttempts = 40) {
  const cleaned = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  const stack = [];
  const boundaries = [];
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') stack.push(ch === '[' ? ']' : '}');
    else if (ch === ']' || ch === '}') {
      stack.pop();
      // 顶层闭合意味着本来就没被截断，交给严格路径；这里只记欠闭合符的中间边界
      if (stack.length) boundaries.push({ end: i + 1, closes: stack.slice().reverse().join('') });
    }
  }
  for (let k = boundaries.length - 1, tried = 0; k >= 0 && tried < maxAttempts; k--, tried++) {
    const { end, closes } = boundaries[k];
    try {
      return JSON.parse(cleaned.slice(start, end) + closes);
    } catch {
      /* 这个边界也补不回来，继续往前退一层 */
    }
  }
  return null;
}

// 严格解析 + 截断抢救。返回 repaired 标记，让调用方能把「输出被截断」这件事
// 如实报到界面上，而不是悄悄少展示几条物种。
export function extractJsonLenient(text) {
  try {
    return { data: extractJson(text), repaired: false };
  } catch (strictError) {
    const data = repairTruncatedJson(text);
    if (data === null) throw strictError;
    return { data, repaired: true, repairReason: strictError.message };
  }
}

// ---------- 调用 ----------

// 硬下限：推理模型的思考过程同样计入 completion_tokens（实测 reasoning_tokens
// 峰值 ≈5800），若 max_tokens 给小了，思考会把额度吃光，content 直接是空串。
// 这个下限不为了让输出更长，而是给「思考」留出足够预算，避免调用方误配。
const MIN_MAX_TOKENS = 4096;

function buildBody({ model, messages, json, temperature, maxTokens, stream }) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: Math.max(Number(maxTokens) || 0, MIN_MAX_TOKENS),
    stream: Boolean(stream),
  };
  // 官方要求使用 json_object 时提示词内必须有 "json" 字样（系统提示词已满足）
  if (json) body.response_format = { type: 'json_object' };
  return body;
}

function normalizeError(status, payload) {
  const message = payload?.error?.message || payload?.message || `HTTP ${status}`;
  const err = new Error(`DeepSeek 调用失败：${message}`);
  err.code = payload?.error?.code || status;
  return err;
}

function guardKey() {
  const cfg = aiConfig();
  if (!cfg.configured) {
    throw Object.assign(new Error('未配置 DEEPSEEK_API_KEY'), { code: 'NO_AI_KEY' });
  }
  return cfg;
}

// 非流式调用，返回最终正文文本（content）。
// 若调用方传了 onReasoning / onContent，则自动改走流式路径 —— 对外仍是同一个
// 「(messages, options) => Promise<string>」签名，调用方不必关心底层是否流式。
//
// 缓存：命中直接返回，不产生任何网络请求与 token 消耗。命中统计在 aiCache 里，
// 通过 /api/status 的 aiCache 字段对外可见。
export async function aiChatText(messages, options = {}) {
  if (options.onReasoning || options.onContent) {
    const { text } = await aiChatStream(messages, options);
    return text;
  }
  const cfg = guardKey();
  const {
    model = aiModel(options.tier),
    json = false,
    temperature = 0.2,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl,
    signal,
  } = options;

  const key = aiCacheKey({ model, temperature, json, maxTokens, messages });
  const cached = aiCacheGet(key);
  if (cached) return cached.text;

  const { promise } = aiCacheDedup(key, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 外部取消（如客户端断开）与本地超时必须同时生效
    const composite = signal && AbortSignal.any ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    usage.calls += 1;
    try {
      const res = await (fetchImpl || fetch)(`${cfg.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        signal: composite,
        body: JSON.stringify(buildBody({ model, messages, json, temperature, maxTokens })),
      });
      const text = await res.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`DeepSeek 返回非 JSON（HTTP ${res.status}）`);
      }
      if (!res.ok || payload?.error) throw normalizeError(res.status, payload);
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw Object.assign(
          new Error(`DeepSeek 返回缺少 content（思考过程可能用尽 max_tokens=${Math.max(Number(maxTokens) || 0, MIN_MAX_TOKENS)} 额度）`),
          { code: 'AI_EMPTY' },
        );
      }
      recordUsage(payload.usage);
      usage.ok += 1;
      return content;
    } catch (e) {
      usage.failed += 1;
      if (e.name === 'AbortError') {
        throw Object.assign(new Error(timeoutMs ? 'DeepSeek 调用超时' : 'DeepSeek 调用已取消'), {
          code: signal?.aborted ? 'AI_ABORTED' : 'AI_TIMEOUT',
        });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });

  const text = await promise;
  // 只在成功时写入：失败与取消都不产生可复用结果，写进去等于把故障固化
  aiCacheSet(key, text);
  return text;
}

// 流式调用：把思考过程与正文增量交给调用方，用于「等待中展示过程」的交互。
// 返回完整正文与完整思考过程，便于调用方在流结束后直接解析 JSON。
//
// 缓存语义（关键）：命中时**回放**完整的 reasoning 与 content 给回调，而不是静默返回终值。
// 「等待期展示模型思考过程」是产品体验的一部分，不能因为缓存命中就消失 ——
// 命中时用户看到的过程完全一样，只是瞬间完成、不消耗任何 token。
export async function aiChatStream(messages, options = {}) {
  const cfg = guardKey();
  const {
    model = aiModel(options.tier),
    json = false,
    temperature = 0.2,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl,
    signal,
    onReasoning,
    onContent,
  } = options;

  const replay = (entry) => {
    if (entry.reasoning) onReasoning?.(entry.reasoning);
    onContent?.(entry.text);
    return { text: entry.text, reasoning: entry.reasoning || '', cached: true };
  };

  const key = aiCacheKey({ model, temperature, json, maxTokens, messages });
  const hit = aiCacheGet(key);
  if (hit) return replay(hit);

  // 流式只有一个「发起者」：后来者挂到同一个 Promise 上，等结果回来后回放。
  // 绝不把两个调用者的增量都推给第一个人的回调 —— 那会把两段思考混在同一界面。
  const { promise, joined } = aiCacheDedup(key, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const composite = signal && AbortSignal.any ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    usage.calls += 1;
    try {
      const res = await (fetchImpl || fetch)(`${cfg.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        signal: composite,
        body: JSON.stringify(buildBody({ model, messages, json, temperature, maxTokens, stream: true })),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch {
          /* 非 JSON 错误体按状态码归一化 */
        }
        throw normalizeError(res.status, payload);
      }
      if (!res.body) throw new Error('DeepSeek 未返回流式响应体');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let reasoning = '';
      let lastUsage = null;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 最后一段可能是被切断的行，留到下一轮拼接
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const payloadText = line.slice(5).trim();
          if (!payloadText || payloadText === '[DONE]') continue;
          let evt;
          try {
            evt = JSON.parse(payloadText);
          } catch {
            continue; // 单个分片坏掉不应中断整条流
          }
          if (evt.usage) lastUsage = evt.usage;
          const delta = evt.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            onReasoning?.(delta.reasoning_content);
          }
          if (delta.content) {
            content += delta.content;
            onContent?.(delta.content);
          }
        }
      }

      if (!content.trim()) {
        // 这是最值得运维关注的一类失败：不是网络问题，而是思考把输出额度吃光。
        // 错误信息里点明原因，避免下次又靠翻日志猜。
        throw Object.assign(
          new Error(`DeepSeek 流式返回缺少 content（思考过程用尽 max_tokens=${maxTokens} 额度，需调大）`),
          { code: 'AI_EMPTY' },
        );
      }
      recordUsage(lastUsage);
      usage.ok += 1;
      // 只缓存生成者的产出，回放由调用方各自完成
      aiCacheSet(key, content, reasoning);
      // joined 时不回放：增量已经实时推给发起者了，再回放等于把内容推两遍
      return { text: content, reasoning, joined: false };
    } catch (e) {
      usage.failed += 1;
      if (e.name === 'AbortError') {
        throw Object.assign(new Error(signal?.aborted ? 'DeepSeek 调用已取消' : 'DeepSeek 调用超时'), {
          code: signal?.aborted ? 'AI_ABORTED' : 'AI_TIMEOUT',
        });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });

  const result = await promise;
  // 发起者拿到的是已经推过回调的结果，直接返回；后来者需要把过程补给自己
  if (joined) return replay({ text: result.text, reasoning: result.reasoning });
  return { text: result.text, reasoning: result.reasoning };
}

// 调用 AI 并解析 JSON。解析失败时抛出带 code 的错误，调用方据此决定是否降级。
export async function aiChatJson(messages, options = {}) {
  const text = await aiChatText(messages, { ...options, json: true });
  try {
    return { data: extractJson(text), text };
  } catch (e) {
    throw Object.assign(new Error(`DeepSeek 输出不是合法 JSON：${e.message}`), { code: 'AI_BAD_JSON' });
  }
}

export { DEFAULT_MAX_TOKENS };
