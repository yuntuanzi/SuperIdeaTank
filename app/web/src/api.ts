import type { BuildEvent, Ecosystem, HotItem, OAuthStatus, ReleaseReport, Species, SpeciesProfile } from './types';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({ error: '响应解析失败' }));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
}

export interface Status {
  liveMode: boolean;
  // 知乎开放平台直答额度（放生/解说已改走 DeepSeek，此项仅作平台额度观测）
  zhidaUsedToday: number;
  ecoCacheCount?: number;
  aiEnabled?: boolean;
  aiConfigured?: boolean;
  aiModels?: { fast: string; pro: string };
  aiUsage?: { calls: number; ok: number; failed: number; promptTokens: number; completionTokens: number; reasoningTokens: number };
}

export const api = {
  status: () => fetch('/api/status').then((r) => json<Status>(r)),
  hot: () =>
    fetch('/api/hot').then((r) =>
      // source 可能是 'snapshot'（真实历史快照）——服务端兜底链原样透传，前端必须能接住
      json<{ items: HotItem[]; source: 'live' | 'demo' | 'snapshot'; fetchedAt?: number; cached?: boolean; snapshotAt?: number; warning?: string }>(r),
    ),
  // 已就绪缸清单（含赛前预构建缸）：点它们走缓存，不消耗接口额度
  tanks: () => fetch('/api/tanks').then((r) => json<{ question: string; url: string; speciesCount: number }[]>(r)),
  ecosystem: (question: string, url?: string) =>
    fetch('/api/ecosystem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, url }),
    }).then((r) => json<Ecosystem>(r)),
  // 流式构建：把构建过程实时上屏，最终 resolve 出与 /api/ecosystem 完全同构的 Ecosystem。
  //
  // 为什么用 fetch + ReadableStream 而不是 EventSource：EventSource 只支持 GET，
  // 而这里必须发请求体（问题标题可能很长）；两者都能读 SSE 格式的分片。
  ecosystemStream: async (
    body: { question: string; url?: string },
    handlers: { onEvent?: (e: BuildEvent) => void; signal?: AbortSignal } = {},
  ): Promise<Ecosystem> => {
    const res = await fetch('/api/ecosystem/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let message = `HTTP ${res.status}`;
      try {
        message = (JSON.parse(text) as { error?: string }).error || message;
      } catch {
        /* 非 JSON 错误体按状态码归一化 */
      }
      throw new Error(message);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: Ecosystem | null = null;
    let failure: string | null = null;
    // SSE 帧可能跨多个网络分片；统一从这里消费完整行，避免最后一帧
    // 没有尾部换行时被遗留在 buffer 里，最终误报「构建未返回结果」。
    const consumeLines = (text: string) => {
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        // 空行与以 ':' 开头的 SSE 注释行（服务端心跳）都不是事件
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        let evt: BuildEvent;
        try {
          evt = JSON.parse(line.slice(5).trim()) as BuildEvent;
        } catch {
          continue; // 单个坏帧不中断整条流
        }
        handlers.onEvent?.(evt);
        if (evt.type === 'result') result = evt.data;
        if (evt.type === 'error') failure = evt.message;
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        // TextDecoder 可能还持有半个 UTF-8 字符，先 flush；再消费没有换行的尾帧。
        buffer += decoder.decode();
        if (buffer.trim()) consumeLines(`${buffer}\n`);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 最后一段可能是被切断的帧，留到下一轮拼接
      buffer = lines.pop() ?? '';
      consumeLines(lines.join('\n'));
    }
    // result 优先于 error：服务端可能先报一次局部失败（如赞同数补齐失败）再正常收尾
    if (result) return result;
    if (handlers.signal?.aborted) {
      throw new DOMException('请求已取消', 'AbortError');
    }
    throw new Error(failure || '构建未返回结果');
  },
  narrative: (question: string, species: Species[]) =>
    fetch('/api/ecosystem/narrative', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, species }) }).then((r) => json<any>(r)),
  narrativeHistory: () => fetch('/api/ecosystem/narrative/history').then((r) => json<{ items: any[]; remaining: number }>(r)),
  release: (question: string, draft: string, species: Species[]) =>
    fetch('/api/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, draft, species }),
    }).then((r) => json<ReleaseReport>(r)),
  quota: () =>
    fetch('/api/quota').then((r) =>
      json<{ liveMode: boolean; items: { APIID: string; APIName: string; TotalQuota: number; TotalUsed: number; RemainingQuota: number }[] }>(r),
    ),
  // ---- 知乎 OAuth（授权跳转是整页 302，不走 fetch：/api/oauth/start 直接作为链接目标）----
  oauthStatus: () => fetch('/api/oauth/status').then((r) => json<OAuthStatus>(r)),
  oauthLogout: () => fetch('/api/oauth/logout', { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  profileSpecies: () => fetch('/api/profile/species').then((r) => json<SpeciesProfile>(r)),
};
