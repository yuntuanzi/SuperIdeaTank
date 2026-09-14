import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import type { HotItem } from '../types';
import { Icon } from './Icon';

// 热榜来源元信息：上报给 App 顶栏做三态数据来源徽标（spec 第 7 节）
export interface HotMeta {
  source?: 'live' | 'demo' | 'snapshot';
  cached?: boolean;
  fetchedAt?: number;
  snapshotAt?: number;
}

// 从知乎问题链接提取问题 id：已就绪缸匹配优先按 id，比字符串全等更抗格式漂移
const questionIdOf = (url: string) => url.match(/zhihu\.com\/question\/(\d+)/)?.[1] ?? null;

export function HotBoard({
  liveMode,
  loading,
  authorized = false,
  onOpen,
  onMeta,
  onQuotaBlocked,
  onRequireAuth,
}: {
  liveMode: boolean;
  loading: boolean;
  authorized?: boolean;
  onOpen: (q: string, url?: string) => void;
  onMeta?: (m: HotMeta) => void;
  onQuotaBlocked?: (pending?: { question: string; url?: string }) => void;
  onRequireAuth?: () => void;
}) {
  const [items, setItems] = useState<HotItem[]>([]);
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [fetching, setFetching] = useState(true);
  // 已就绪缸的问题 id 集合：命中的热榜条目加「缸已就绪」徽标并排最前（spec 第 6 节）
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFetching(true);
    // 热榜与已就绪清单并行请求；/api/tanks 失败时静默降级——
    // 不显示徽标、不改排序、不报错，不能因为辅助接口挂掉拖累主流程
    api
      .tanks()
      .then((list) => {
        setReadyIds(new Set(list.map((t) => questionIdOf(t.url)).filter((x): x is string => !!x)));
      })
      .catch(() => {});
    api
      .hot()
      .then((d) => {
        setItems(d.items);
        setWarning(d.warning || '');
        onMeta?.({ source: d.source, cached: d.cached, fetchedAt: d.fetchedAt, snapshotAt: d.snapshotAt });
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setFetching(false));
    // onMeta 是 App 传入的 setState，引用稳定，无需进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openItem = (it: HotItem, index: number) => {
    if (!authorized) { onRequireAuth?.(); return; }
    if (index >= 8) { onQuotaBlocked?.({ question: it.title, url: it.url }); return; }
    onOpen(it.title, it.url);
  };

  const isReady = (it: HotItem) => {
    const id = questionIdOf(it.url);
    return id !== null && readyIds.has(id);
  };
  // 已就绪条目排到最前：评委零额度也能点开秒出，这是评审路径的主入口
  const sortedItems = [...items].sort((a, b) => Number(isReady(b)) - Number(isReady(a)));
  const readyCount = items.filter(isReady).length;

  const submit = () => {
    if (!authorized) { onRequireAuth?.(); return; }
    const q = query.trim();
    if (q.length < 4) return;
    const m = q.match(/https?:\/\/(www\.)?zhihu\.com\/question\/(\d+)/);
    if (m && m[2]) {
      onQuotaBlocked?.({ question: `知乎问题 ${m[2]}`, url: `https://www.zhihu.com/question/${m[2]}` });
    } else {
      onQuotaBlocked?.({ question: q });
    }
  };

  return (
    <div>
      <section className="hero">
        <div className="kicker">ZHIHU HACKATHON 2026 · OPINION EVOLUTION TANK</div>
        <h2 id="hero-title">
          每一个问题，都是一片观点厮杀的生态缸。
          <br />
          现在，你可以亲眼看见这场进化。
        </h2>
        <p>
          赞同是能量，评论是繁殖，折叠是灭绝，热榜是气候突变。高赞回答不一定是正确的，而是最适应生态位的那个物种——我们把它可视化给你看。
        </p>
        {/* 三个能力锚点：评委只有 3 分钟，要让他们在滚动前就知道产品能做什么；
            图标卡形式，图标与右栏 Tab 共用同一套视觉语言 */}
        <div className="hero-caps">
          <div className="cap">
            <Icon.Target size={18} />
            <div>
              <div style={{ fontWeight: 600, color: '#fff' }}>观点物种识别</div>
              <div style={{ fontSize: '11.5px', color: 'var(--ink-3)', marginTop: '2px' }}>AI 聚类立场与论证策略</div>
            </div>
          </div>
          <div className="cap">
            <Icon.History size={18} />
            <div>
              <div style={{ fontWeight: 600, color: '#fff' }}>演化时间轴重建</div>
              <div style={{ fontSize: '11.5px', color: 'var(--ink-3)', marginTop: '2px' }}>回溯观点争鸣时序更迭</div>
            </div>
          </div>
          <div className="cap">
            <Icon.Flask size={18} />
            <div>
              <div style={{ fontWeight: 600, color: '#fff' }}>放生存活预测</div>
              <div style={{ fontSize: '11.5px', color: 'var(--ink-3)', marginTop: '2px' }}>模拟新回答生存概率</div>
            </div>
          </div>
        </div>
      </section>

      {/* 命令栏式搜索：图标 + 输入 + 主按钮合成一个整体胶囊 */}
      <div className="search-shell">
        <Icon.Search size={16} className="search-icon" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="输入知乎问题标题，或直接粘贴问题链接（zhihu.com/question/…）…"
        />
        <button className="btn primary" onClick={submit} disabled={loading || query.trim().length < 4}>
          {loading ? '构建中…' : '创建生态缸'}
        </button>
      </div>

      {err && (
        <div className="err">
          <Icon.AlertTriangle size={14} />
          <span>{err}</span>
        </div>
      )}
      {warning && <div className="toast is-warn" role="status"><Icon.AlertTriangle size={13} /><span>{warning}</span></div>}

      <div className="section-head">
        <h3>热榜选题</h3>
        <span className="hint">
          {liveMode ? '来自知乎热榜 · 服务端缓存 12 小时' : '演示数据 · 配置 Access Secret 后切换实时热榜'}
          {readyCount > 0 && ' · 标「缸已就绪」的问题为赛前预构建，点开秒出、不消耗接口额度'}
        </span>
      </div>

      {fetching ? (
        /* 骨架屏：按最终卡片网格搭 6 张占位卡（序号 + 双行文字 + 操作位），
           静态块一次性淡入，版式与真实卡片一致，感知等待短于一行转圈文字 */
        <div className="hot-list" aria-busy="true" aria-label="正在获取热榜">
          <div className="sk-head">正在获取知乎热榜…</div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="sk-card" key={i} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="sk-line" style={{ width: 26, height: 20 }} />
              <span className="sk-line" style={{ width: `${88 - i * 5}%` }} />
              <span className="sk-line" style={{ width: `${62 - i * 5}%`, opacity: 0.65 }} />
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span className="sk-line" style={{ width: 52 }} />
                <span className="sk-line" style={{ width: 96, height: 30, borderRadius: 8 }} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="hot-list">
          {sortedItems.map((it, i) => (
            <div className="hot-card" key={i} style={{ '--i': i } as CSSProperties}>
              <div className="hot-card-top">
                <span className="hot-rank">{String(i + 1).padStart(2, '0')}</span>
                {isReady(it) && <span className="ready-badge">缸已就绪</span>}
              </div>
              {/* 标题区整块可点开缸：卡片交互的主命中区，
                  键盘 Enter/Space 同效；卡底「原问题」外链是独立目标互不干扰 */}
              <div
                className="hot-main"
                role="button"
                tabIndex={0}
                onClick={() => !loading && openItem(it, i)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !loading) {
                    e.preventDefault();
                    onOpen(it.title, it.url);
                  }
                }}
              >
                <div className="hot-title">{it.title}</div>
                <div className="hot-summary">{it.summary || '（无摘要）'}</div>
              </div>
              <div className="hot-actions">
                <a className="hot-link" href={it.url} target="_blank" rel="noreferrer">
                  <Icon.ExternalLink size={12} /> 知乎原题
                </a>
                <button className="btn primary" disabled={loading} onClick={() => openItem(it, i)}>
                  {loading ? '构建中…' : isReady(it) ? '进入生态缸' : '构建生态缸'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
