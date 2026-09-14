import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { BuildEvent, Ecosystem, EnvParams, OAuthStatus, ReleaseReport, Species } from './types';
import { HotBoard } from './components/HotBoard';
import type { HotMeta } from './components/HotBoard';
import { Tank } from './components/Tank';
import { Workspace } from './components/Workspace';
import { BuildProgress } from './components/BuildProgress';
import { Icon } from './components/Icon';
import { classifyQuestion, isExplanationType } from './lib/questionType';

// 采集时间统一短格式：徽标空间只有一行，完整 locale 串会顶破顶栏
const fmtCollected = (ts?: number) =>
  ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未知时间';

// 进度卡延迟出现的阈值：命中预构建缓存时整条链路只要几十毫秒，
// 闪一下进度卡再消失比不显示更刺眼；超过这个时长才值得展示过程。
const PROGRESS_DELAY_MS = 350;

export default function App() {
  const [status, setStatus] = useState<{ liveMode: boolean } | null>(null);
  const [view, setView] = useState<'board' | 'tank'>(() => {
    return new URLSearchParams(window.location.search).get('view') === 'tank' ? 'tank' : 'board';
  });
  const [eco, setEco] = useState<Ecosystem | null>(null);
  const [restoring, setRestoring] = useState(() => new URLSearchParams(window.location.search).get('view') === 'tank');
  const [restoreError, setRestoreError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 热榜来源元信息由 HotBoard 上报，顶栏三态徽标需要它区分 实时/缓存/快照（spec 第 7 节）
  const [hotMeta, setHotMeta] = useState<HotMeta | null>(null);
  // OAuth 授权态：profile 只有展示字段（昵称/头像），token 永远不下发前端
  const [oauth, setOauth] = useState<OAuthStatus | null>(null);
  // 授权回执带成功/失败态：图标语义不同（对勾 vs 警告），不能共用一个图标
  const [oauthNotice, setOauthNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [authModal, setAuthModal] = useState(false);
  // 构建过程：building = 正在构建的问题；buildEvents = 服务端推来的过程事件流
  const [building, setBuilding] = useState<{ question: string } | null>(null);
  const [buildEvents, setBuildEvents] = useState<BuildEvent[]>([]);
  const [showProgress, setShowProgress] = useState(false);
  // 同一时刻只允许一条构建：连点不同问题必须中止上一条，否则并行烧 token
  const abortRef = useRef<AbortController | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus({ liveMode: false }));
    api.oauthStatus().then((nextOauth) => {
      setOauth(nextOauth);
      const onHome = new URLSearchParams(window.location.search).get('view') !== 'tank';
      if (onHome && !nextOauth.authorized && !sessionStorage.getItem('home-auth-prompted')) {
        sessionStorage.setItem('home-auth-prompted', '1');
        setAuthModal(true);
      }
    }).catch(() => setOauth(null));
    // 通过 URL 恢复当前生态缸：服务端优先命中生态缓存，不重复消耗 AI/知乎额度。
    const params = new URLSearchParams(window.location.search);
    const savedQuestion = params.get('question');
    if (params.get('view') === 'tank' && savedQuestion) {
      api.ecosystem(savedQuestion, params.get('url') || undefined)
        .then((data) => setEco(data))
        .catch((e) => { setRestoreError((e as Error).message); setView('board'); })
        .finally(() => setRestoring(false));
    } else {
      setRestoring(false);
    }
    // 从知乎授权页跳回来时 URL 带 ?oauth=ok/err（服务端 302 回来的），
    // 消费掉这个一次性标记：展示结果、清掉参数，避免刷新后提示复读
    const flag = new URLSearchParams(window.location.search).get('oauth');
    if (flag) {
      setOauthNotice(flag === 'ok' ? { text: '知乎账号授权成功', ok: true } : { text: '授权未完成，请重试', ok: false });
      const callbackUrl = new URL(window.location.href);
      callbackUrl.searchParams.delete('oauth');
      window.history.replaceState(null, '', callbackUrl);
      // 回调刚写完会话，重新拉一次授权态而不是用首屏的旧值
      api.oauthStatus().then(setOauth).catch(() => {});
    }
  }, []);

  // 卸载时收尾：留着未中止的流会在后台继续烧 token
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.oauthLogout().catch(() => {});
    // 登出后回到选题台：画像数据已随会话失效，留在画像页只会渲染出 401
    setView('board');
    setOauth(await api.oauthStatus().catch(() => null));
  }, []);

  // 数据来源徽标三态（诚信要求）：「真实数据的历史缓存」和「虚构的演示数据」是两回事，
  // 绝不能共用一个徽标。缸视图看 eco.cached，选题台视图看热榜 source/cached。
  const badge = useMemo((): { text: string; cls: string } => {
    if (!status?.liveMode) return { text: '演示数据集 · 未接入开放平台', cls: 'demo' };
    if (view === 'tank' && eco) {
      return eco.cached
        ? { text: `缓存 · 采集于 ${fmtCollected(eco.createdAt)}`, cls: 'cache' }
        : { text: '实时 · 知乎开放平台', cls: 'live' };
    }
    if (hotMeta?.source === 'snapshot') {
      return { text: `热榜快照 · 采集于 ${fmtCollected(hotMeta.snapshotAt ?? hotMeta.fetchedAt)}`, cls: 'cache' };
    }
    if (hotMeta?.cached) return { text: `缓存 · 采集于 ${fmtCollected(hotMeta.fetchedAt)}`, cls: 'cache' };
    return { text: '实时 · 知乎开放平台', cls: 'live' };
  }, [status, view, eco, hotMeta]);

  // 构建收尾只对「当前这一条」生效：被中止的旧请求不能把新请求的加载态清掉
  const finishBuild = useCallback((ac: AbortController) => {
    if (abortRef.current !== ac) return;
    if (progressTimerRef.current !== null) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setShowProgress(false);
    setBuilding(null);
    setLoading(false);
  }, []);

  // 流式打开生态缸：边构建边把过程展示给用户，全部完成后再切到缸视图。
  // 之所以用流式而不是等一个 POST 返回：真实构建里有 10s 逐条识别 + 40s 派系归纳，
  // 全程黑屏等待体验极差。
  const openTank = useCallback(
    async (question: string, url?: string) => {
      setError('');
      // 中止上一次未完成的构建（快速换题时不并行烧 token）
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBuildEvents([]);
      // 构建一开始就写入 URL，等待过程中刷新也能恢复当前问题。
      const buildUrl = new URL(window.location.href);
      buildUrl.searchParams.set('view', 'tank');
      buildUrl.searchParams.set('question', question);
      if (url) buildUrl.searchParams.set('url', url); else buildUrl.searchParams.delete('url');
      window.history.pushState({ view: 'tank', question, url, building: true }, '', buildUrl);
      setBuilding({ question });
      setShowProgress(false);
      progressTimerRef.current = window.setTimeout(() => setShowProgress(true), PROGRESS_DELAY_MS);
      setLoading(true);
      try {
        const data = await api.ecosystemStream(
          { question, url },
          {
            signal: ac.signal,
            // result 事件携带完整 Ecosystem，单独走 setEco，不塞进过程事件数组
            onEvent: (e) => {
              if (e.type === 'result') return;
              setBuildEvents((prev) => [...prev, e]);
            },
          },
        );
        finishBuild(ac);
        setEco(data);
        setView('tank');
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('view', 'tank');
        nextUrl.searchParams.set('question', question);
        if (url) nextUrl.searchParams.set('url', url);
        else nextUrl.searchParams.delete('url');
        window.history.pushState({ view: 'tank', question, url }, '', nextUrl);
        window.scrollTo(0, 0);
      } catch (e) {
        finishBuild(ac);
        // 主动取消不是错误，不该弹红条
        if ((e as Error).name === 'AbortError') return;
        if ((e as Error).message.includes('授权登录知乎账号') || (e as Error).message.includes('LOGIN_REQUIRED')) {
          setAuthModal(true);
        } else {
          setError((e as Error).message);
        }
      }
    },
    [finishBuild],
  );

  const cancelBuild = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (progressTimerRef.current !== null) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setShowProgress(false);
    setBuilding(null);
    setLoading(false);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
          <button className="brand" type="button" aria-label="返回首页" onClick={() => {
            setView('board');
            setEco(null);
            const homeUrl = new URL(window.location.href);
            homeUrl.search = '';
            window.history.pushState({ view: 'board' }, '', homeUrl);
          }}>
          <svg className="brand-mark" viewBox="0 0 34 34" aria-hidden="true">
            <rect x="1.5" y="1.5" width="31" height="31" rx="9" fill="#0D1B2E" />
            <circle cx="12" cy="14" r="4.5" fill="rgba(66,133,244,0.45)" stroke="#7FAAF0" strokeWidth="1" />
            <circle cx="21.5" cy="20" r="3.2" fill="rgba(224,110,74,0.4)" stroke="#E89A7E" strokeWidth="1" />
            <circle cx="23" cy="10.5" r="2.2" fill="rgba(46,196,143,0.45)" stroke="#7FD8B8" strokeWidth="1" />
            <path d="M6 26c4-3 8-3 11 0s7 3 11 0" fill="none" stroke="#8FA3BD" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <div>
            <h1>观点进化缸</h1>
            <div className="sub">Opinion Evolution Tank · 像生物学家一样围观知乎</div>
          </div>
          </button>
        <div className="topbar-actions">
          {view !== 'board' && (
            <button className="backlink" onClick={() => {
              setView('board');
              const nextUrl = new URL(window.location.href);
              nextUrl.searchParams.delete('view');
              nextUrl.searchParams.delete('question');
              nextUrl.searchParams.delete('url');
              window.history.pushState({ view: 'board' }, '', nextUrl);
            }}>
              <Icon.ArrowLeft size={13} /> 返回选题台
            </button>
          )}
          <OAuthArea oauth={oauth} onLogout={logout} />
          <span className={`source-badge ${badge.cls}`}>{badge.text}</span>
        </div>
      </header>

      {oauthNotice && (
        <div className={`toast ${oauthNotice.ok ? 'is-ok' : 'is-err'}`} role="status">
          {oauthNotice.ok ? <Icon.Check size={13} /> : <Icon.AlertTriangle size={13} />}
          <span>{oauthNotice.text}</span>
          <button className="toast-close" onClick={() => setOauthNotice(null)} aria-label="关闭提示"><Icon.X size={13} /></button>
        </div>
      )}
      {authModal && (
        <div className="auth-modal-backdrop" role="presentation" onClick={() => setAuthModal(false)}>
          <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-mark"><Icon.User size={18} /></div>
            <h2 id="auth-title">请先授权知乎账号</h2>
            <p>AI 生态缸需要使用你的知乎授权身份，用于访问公开回答并生成专属解说。授权不会把账号凭证交给前端。</p>
            <div className="auth-modal-actions">
              <button className="backlink" onClick={() => setAuthModal(false)}>稍后再说</button>
              <button className="oauth-btn" onClick={() => { window.location.href = '/api/oauth/start'; }}>授权登录知乎</button>
            </div>
          </div>
        </div>
      )}
      {(error || restoreError) && (
        <div className="err" style={{ marginBottom: 14 }}>
          <Icon.AlertTriangle size={14} />
          <span>{error || restoreError}</span>
        </div>
      )}

      {/* key=view：视图切换时重挂载触发一次入场淡入，三个视图各自独立成段 */}
      <main key={view} className="view-root">
        {restoring ? (
          <div className="loading">正在恢复生态缸…</div>
        ) : view === 'board' ? (
          building && showProgress ? (
            // 构建过程替代选题台：让用户在等待时看得见「在哪一步、模型在想什么」
            <BuildProgress question={building.question} events={buildEvents} onCancel={cancelBuild} />
          ) : (
            <HotBoard liveMode={status?.liveMode ?? false} loading={loading} onOpen={openTank} onMeta={setHotMeta} />
          )
        ) : eco ? (
          <TankView eco={eco} onOpen={openTank} />
        ) : null}
      </main>

      <p className="footer-note">
        观点进化缸 · 知乎黑客松 2026 校园新锐季参赛作品 ｜ 数据来自知乎开放平台官方 API ｜
        观点识别与整缸解说由 DeepSeek 大模型完成，存活概率由公开规则模型产出（AI 不参与数值）｜
        时间轴为 AI 演化重建，放生结果为 AI 模拟预测，均非知乎平台历史数据
      </p>
    </div>
  );
}

// 顶栏授权区三态：未配回调（禁用 + 可见说明）/ 未授权（可点击跳转知乎）/ 已授权（头像昵称 + 退出）。
// 授权跳转必须是整页 302（window.location），不能用 fetch 代发——
// 最终确认页在知乎域名下，必须由用户本人亲自点击。
function OAuthArea({ oauth, onLogout }: { oauth: OAuthStatus | null; onLogout: () => void }) {
  if (!oauth) return null;
  if (oauth.authorized) {
    return (
      <span className="oauth-user">
        {oauth.profile?.avatarUrl && <img className="oauth-avatar" src={oauth.profile.avatarUrl} alt="" />}
        <span className="oauth-name">{oauth.profile?.name || '已授权知乎账号'}</span>
        <button className="backlink" onClick={onLogout}>
          <Icon.LogOut size={12} /> 退出
        </button>
      </span>
    );
  }
  if (!oauth.callbackConfigured) {
    // 部署前本地预览态：按钮禁用并给出文字说明（tooltip 截图和触屏都看不到，文案必须落在页面上）
    return (
      <span className="oauth-user">
        <button className="oauth-btn" disabled title="等待部署后开放">
          授权知乎账号
        </button>
        <span className="oauth-hint">等待部署后开放</span>
      </span>
    );
  }
  return (
    <button className="oauth-btn" onClick={() => (window.location.href = '/api/oauth/start')}>
      授权知乎账号
    </button>
  );
}

function TankView({ eco, onOpen }: { eco: Ecosystem; onOpen: (q: string, url?: string) => void }) {
  const [params, setParams] = useState<EnvParams>({ rankMode: 'votes', climate: 'rational', authorityBoost: false });
  const [timeIdx, setTimeIdx] = useState<number>(1);
  const [playedEntry, setPlayedEntry] = useState(false);
  useEffect(() => {
    const key = `tank-entry-played:${eco.question}:${eco.createdAt}`;
    const already = sessionStorage.getItem(key);
    if (already) { setTimeIdx(eco.species.length); setPlayedEntry(true); return; }
    setTimeIdx(1);
    let idx = 1;
    const timer = window.setInterval(() => {
      idx += 1;
      setTimeIdx(Math.min(idx, eco.species.length));
      if (idx >= eco.species.length) {
        window.clearInterval(timer);
        sessionStorage.setItem(key, '1');
        setPlayedEntry(true);
      }
    }, 260);
    return () => window.clearInterval(timer);
  }, [eco.question, eco.createdAt, eco.species.length]);
  const [release, setRelease] = useState<ReleaseReport | null>(null);

  const sorted = useMemo(() => [...eco.species].sort((a, b) => a.editTime - b.editTime), [eco.species]);
  const visible = useMemo(() => sorted.slice(0, Math.max(1, timeIdx)), [sorted, timeIdx]);

  const dominant = useMemo(() => {
    if (!visible.length) return null;
    return visible.reduce((a, b) => ((b.votes ?? -1) > (a.votes ?? -1) ? b : a));
  }, [visible]);

  const isQa = (eco as { dataSource?: string }).dataSource === 'question_answers';
  // annotationWarning 分情况措辞（附录 A3）：立场告警在归因/求解型问题上是误导——
  // 那里多数回答中立可能完全正确；「维度不适用」不能说成「模型判不准」。
  // 策略告警与判断型问题的立场告警一律原样显示服务端文案。
  const qtype = classifyQuestion(eco.question);
  const warnText = (() => {
    const w = eco.annotationWarning;
    if (!w) return null;
    if (w.startsWith('立场') && isExplanationType(qtype)) {
      return `本题为${qtype === 'why' ? '归因' : '求解'}型提问，回答以解释为主而非站队 —— 立场维度参考价值有限`;
    }
    return w;
  })();
  const stanceCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of visible) m.set(s.stance, (m.get(s.stance) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [visible]);

  return (
    <div className="tank-layout">
      <div>
        <div className="tank-head">
          <div style={{ minWidth: 0 }}>
            <div className="q">{eco.question}</div>
            <div className="tank-stats">
              <span className="stat-chip">物种 <b>{eco.species.length}</b></span>
              {dominant && (
                <span className="stat-chip">
                  优势 <b>{dominant.stance}·{dominant.strategy}</b>
                </span>
              )}
              <span className="stat-chip">立场 <b>{stanceCount.map(([k, v]) => `${k}×${v}`).join(' / ') || '—'}</b></span>
              {eco.cached && <span className="stat-chip">24h 缓存</span>}
              {isQa && <span className="stat-chip">问题回答直取</span>}
            </div>
          </div>
        </div>
        {/* 标注器自我诊断告警统一作为右上角消息提示，不占用内容流。 */}
        {warnText && <div className="toast is-warn toast-tank" role="status"><Icon.AlertTriangle size={13} /><span>{warnText}</span></div>}
        {eco.narrative && <div className="narrative">{eco.narrative}</div>}
        <Tank
          species={visible}
          all={eco.species}
          params={params}
          question={eco.question}
          sourceLabel={eco.source === 'live' ? (isQa ? '知乎问题回答 · 实时直取' : '知乎搜索 · 实时检索') : '内置演示数据集'}
        />
      </div>
      <Workspace
        eco={eco}
        sorted={sorted}
        timeIdx={timeIdx}
        onTimeIdx={setTimeIdx}
        params={params}
        onParams={setParams}
        release={release}
        onRelease={setRelease}
      />
    </div>
  );
}
