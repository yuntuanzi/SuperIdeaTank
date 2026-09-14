import { useEffect, useMemo, useRef, useState } from 'react';
import type { Species, Stance, Strategy } from '../types';
import { STANCES, STRATEGIES, UNIDENTIFIED, isAiSource, aiSourceModel } from '../types';
import { buildLayout } from '../lib/force';
import type { VizNode } from '../lib/force';
import { classifyQuestion, isExplanationType } from '../lib/questionType';
import { Icon } from './Icon';

const W = 880;
const H = 540;

// ---------- 立场配色（深色观测窗专用，组件内局部常量） ----------
// types.ts 被 spec 锁定（下游有并行模块在改），且原 STANCE_DARK 里
// 中立/解构/补充 在 #0D1B2E 底上几乎同色。这里按色相间隔 ≥45° 重排六色，
// 保持「低饱和 + 半透明填充 + 亮描边」的既有质感，不变糖果色。
// 色盲友好兜底：填充透明度分两档——支持/反对/解构 用 0.24 档，
// 中立/反讽/补充 用 0.13 档，即使色相难辨也能按明暗分组。
const TANK_STANCE: Record<Stance, { fill: string; stroke: string; text: string }> = {
  支持: { fill: 'rgba(96, 148, 230, 0.24)', stroke: '#8FB8F2', text: '#B7D0F7' }, // 蓝 ~215°
  反对: { fill: 'rgba(232, 120, 84, 0.24)', stroke: '#F09A80', text: '#F7C2AE' }, // 橙红 ~12°
  解构: { fill: 'rgba(72, 200, 160, 0.24)', stroke: '#77D8B4', text: '#ACE7D0' }, // 青绿 ~165°
  中立: { fill: 'rgba(180, 194, 210, 0.13)', stroke: '#CBD4DF', text: '#DDE4EC' }, // 无彩色，靠明度区分
  反讽: { fill: 'rgba(146, 126, 232, 0.13)', stroke: '#B9AAEF', text: '#D2C9F6' }, // 紫 ~262°
  补充: { fill: 'rgba(216, 188, 110, 0.13)', stroke: '#E3CD8C', text: '#EFE0B4' }, // 琥珀 ~48°
};

// ---------- 生存策略配色（深色观测窗，色轴自适应用，附录 A1） ----------
// 归因型 / 求解型问题的回答以解释为主、不站队，立场维度对它们不成立，
// 渲染成一片灰既是视觉问题也是概念错误——换一个对这类问题成立的维度：按生存策略上色。
// 六色色相间隔 ≥45°（12/60/120/180/240/300），与立场色同样低饱和半透明 + 亮描边；
// 透明度分两档（0.20/0.14~0.16），色相难辨时仍能按明暗分组。
const TANK_STRATEGY: Record<Strategy, { fill: string; stroke: string; text: string }> = {
  数据论证: { fill: 'rgba(110, 130, 235, 0.20)', stroke: '#93A6EF', text: '#C0CBF8' }, // 蓝 ~240°
  情绪共鸣: { fill: 'rgba(232, 120, 84, 0.20)', stroke: '#F09A80', text: '#F7C2AE' }, // 橙红 ~12°
  故事叙事: { fill: 'rgba(210, 195, 110, 0.14)', stroke: '#E0D38C', text: '#EEE4B8' }, // 黄 ~60°
  身份站队: { fill: 'rgba(90, 200, 120, 0.16)', stroke: '#8FD39A', text: '#B8E6C2' }, // 绿 ~120°
  抖机灵: { fill: 'rgba(70, 200, 185, 0.14)', stroke: '#7FD8CE', text: '#AAE8E0' }, // 青 ~180°
  引用权威: { fill: 'rgba(200, 110, 195, 0.16)', stroke: '#DF9ADA', text: '#EFC2EA' }, // 品红 ~300°
};

// 零证据策略判定（附录 A2）：能诚实说「判不了」比硬塞进六个格子更可信。
// 两种来源都要覆盖：
//  - 本地标注器：策略兜底为「数据论证」，靠 evidence.strategy 为空或首条「特征不足」识别；
//  - AI 判定：直接返回字面量「未识别」（枚举里的合法值），必须显式识别，
//    否则会被当成第七种策略去做配色查表 → 拿到 undefined 颜色。
// demo 预设标签不是机器判定，不参与此判定（演示缸应如实展示预设标签本身）。
export function isStrategyUnidentified(s: Species): boolean {
  if (s.annotationSource === 'demo') return false;
  if (String(s.strategy) === UNIDENTIFIED) return true;
  const ev = s.evidence?.strategy ?? [];
  return ev.length === 0 || ev[0].term === '特征不足';
}

// 权威等级 → 描边粗细（第四维编码）：1 / 1.4 / 2 / 2.8px，
// 大 V 在缸里一眼可辨，不需要读文字。
const AUTHORITY_STROKE = [1, 1.4, 2, 2.8];

// ---------- 生存策略符号（第三维编码） ----------
// 14×14 纯描边极简符号，替代原来圆下方的一行小字：
// 10 个节点 = 10 行小字的视觉噪音被压缩成圆内图形。
// 导出给「我的观点画像」页复用（spec 3.4：画像页与生态缸用同一套策略符号）
export function StrategyGlyph({ s, x, y, color }: { s: Strategy; x: number; y: number; color: string }) {
  const line = {
    stroke: color,
    strokeWidth: 1.3,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r={1.3} fill={color} />;
  return (
    <g transform={`translate(${x - 7} ${y - 7})`} aria-hidden="true">
      {s === '数据论证' && <path {...line} d="M2.5 11.5 V7.5 M7 11.5 V4.5 M11.5 11.5 V2" />}
      {s === '情绪共鸣' && <path {...line} d="M1.5 7 C3.5 4 5.5 4 7 7 S10.5 10 12.5 7" />}
      {s === '故事叙事' && (
        <>
          {dot(2.5, 10.5)}
          <path {...line} d="M4 10 L7 4.5 L10 8 L12.5 3" />
        </>
      )}
      {s === '身份站队' && (
        <>
          <path {...line} d="M7 1.5 V12.5" />
          {dot(3.2, 7)}
          {dot(10.8, 7)}
        </>
      )}
      {s === '抖机灵' && <path {...line} d="M8 1.5 L4.5 7.5 H7.2 L6 12.5 L10 5.8 H7.4 Z" />}
      {s === '引用权威' && (
        <>
          <path {...line} d="M5 3 C3.8 4.2 3.2 5.4 3.2 7" />
          {dot(3.2, 8.8)}
          <path {...line} d="M9.8 3 C8.6 4.2 8 5.4 8 7" />
          {dot(8, 8.8)}
        </>
      )}
    </g>
  );
}

// ---------- 节点入场 / 重算过渡 ----------
// 时间轴拖动、环境参数切换时，节点从上一状态（新节点从 r=0）缓动到目标，
// 180ms 内完成，让「重算」肉眼可见；运动只由用户操作触发，符合红线（禁循环动画）。
// cubic-bezier(.22,.61,.36,1) 与 easeOutCubic 视觉上几乎一致，
// 用多项式近似可避免引入贝塞尔求解代码。
function useTweenNodes(target: VizNode[]): VizNode[] {
  const [rendered, setRendered] = useState<VizNode[]>(target);
  const prevRef = useRef<Map<string, VizNode>>(new Map());

  useEffect(() => {
    const prev = prevRef.current;
    const from = new Map(target.map((n) => [n.id, prev.get(n.id) ?? { ...n, r: 0 }]));
    const DUR = 180;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DUR);
      const k = ease(t);
      setRendered(
        target.map((n) => {
          const f = from.get(n.id) ?? n;
          const fx = Number.isFinite(f.x) ? f.x : n.x;
          const fy = Number.isFinite(f.y) ? f.y : n.y;
          const fr = Number.isFinite(f.r) ? f.r : 0;
          const radius = fr + (n.r - fr) * k;
          return { ...n, x: fx + (n.x - fx) * k, y: fy + (n.y - fy) * k, r: Math.max(1, Number.isFinite(radius) ? radius : n.r) };
        }),
      );
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        prevRef.current = new Map(target.map((n) => [n.id, n]));
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return rendered;
}

export function Tank({
  species,
  all,
  params,
  question,
  sourceLabel,
}: {
  species: Species[];
  all: Species[];
  params: { rankMode: 'votes' | 'recent'; climate: 'rational' | 'emotional'; authorityBoost: boolean };
  question: string;
  sourceLabel: string;
}) {
  const [selected, setSelected] = useState<Species | null>(null);
  // hover 只用于「非 Top3 节点悬浮时才显示策略标签」，不影响任何数据逻辑
  const [hovered, setHovered] = useState<string | null>(null);

  const { nodes, links } = useMemo(
    () => buildLayout(species, all, params, W, H),
    [species, all, params],
  );

  const safeNodes = useMemo(() => nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.r)), [nodes]);
  const tweened = useTweenNodes(safeNodes);

  // 连线端点改从补间后的节点取坐标，否则节点在动、连线跳变，两者会脱节
  const resolved = useMemo(
    () =>
      links
        .map((l) => {
          const sourceId = typeof l.source === 'object' ? l.source?.id : l.source;
          const targetId = typeof l.target === 'object' ? l.target?.id : l.target;
          const a = tweened.find((n) => n.id === sourceId);
          const b = tweened.find((n) => n.id === targetId);
          return a && b ? { kind: l.kind, a, b } : null;
        })
        .filter((l): l is { kind: 'camp' | 'rival'; a: VizNode; b: VizNode } => Boolean(l)), 
    [links, tweened],
  );

  // 文字标签规则：只有能量 Top 3 常驻策略标签，其余 hover / 点击才显示，
  // 避免 10 个节点 10 行小字的噪音（spec 4.3）
  const top3 = useMemo(
    () => new Set([...nodes].sort((a, b) => b.energy - a.energy).slice(0, 3).map((n) => n.id)),
    [nodes],
  );

  const dominant = useMemo(() => {
    if (!nodes.length) return null;
    return nodes.reduce((a, b) => ((b.votes ?? -1) > (a.votes ?? -1) ? b : a));
  }, [nodes]);

  // 色轴自适应（附录 A1）：归因/求解型问题的回答在解释而非站队，
  // 立场维度对它们不成立——这类缸的节点颜色改用生存策略编码，
  // 不是把灰数据藏起来，而是换一个对这类问题成立的维度。
  const qtype = classifyQuestion(question);
  const byStrategy = isExplanationType(qtype);
  // 策略未识别的节点在策略色轴下没有可编码的值，回落为无彩色（中立色），
  // 与虚线外描边一起表达「这条我判不了」。
  const colorOf = (n: Species) =>
    byStrategy
      ? isStrategyUnidentified(n)
        ? TANK_STANCE.中立
        : TANK_STRATEGY[n.strategy]
      : TANK_STANCE[n.stance];

  const unidentifiedCount = useMemo(() => nodes.filter(isStrategyUnidentified).length, [nodes]);
  // 是否有按热序近似的节点：决定图例是否解释「虚线内环」
  const hasApprox = useMemo(() => nodes.some((n) => n.votes == null), [nodes]);

  if (!species.length) {
    return (
      <div className="tank-svg-wrap">
        <div className="loading" style={{ color: 'var(--tank-dim)' }}>该问题暂无可用回答样本，换一个问题试试。</div>
      </div>
    );
  }

  return (
    <div>
      <div className="tank-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${question} 的观点生态缸`}>
          <title>观点生态缸</title>
          <defs>
            <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="1.2" fill="rgba(148, 178, 216, 0.13)" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#dots)" />

          {resolved.map((l, i) => {
            const a = l.a;
            const b = l.b;
            if (l.kind === 'camp') {
              return (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(148, 178, 216, 0.28)" strokeWidth={1} />
              );
            }
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#E89A7E"
                strokeOpacity={0.55}
                strokeWidth={1.3}
                strokeDasharray="7 6"
              />
            );
          })}

          {tweened.map((n) => {
            const unid = isStrategyUnidentified(n);
            const c = colorOf(n);
            const isSel = selected?.id === n.id;
            const showTag = top3.has(n.id) || isSel || hovered === n.id;
            // 权威等级映射到描边档位，超出 1–4 的值收敛到端点，避免异常数据画爆
            const ai = Math.min(4, Math.max(1, Math.round(n.authority || 1))) - 1;
            const sw = isSel ? AUTHORITY_STROKE[ai] + 1 : AUTHORITY_STROKE[ai];
            // 小圆（r<26）内不放任何文字：原来小圆塞「中立」两字直接溢出圆外，
            // 改为只放策略符号；文字只在圆够大时出现
            const hasText = n.r >= 26;
            // 无公开赞同数的节点：半径是热序近似值而非真实赞同换算，
            // 加一道低透明度细虚线内环让两种量纲在视觉上可区分（spec 第 2 节）
            const approx = n.votes == null;
            // 低置信（<0.15）：不是错误是不确定，用空心小问号，不用红色（spec 第 3 节）
            const lowConf = n.confidence < 0.15;
            return (
              <g
                key={n.id}
                className="node-g"
                onClick={() => setSelected(isSel ? null : n)}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
              >
                <circle cx={n.x} cy={n.y} r={Math.max(1, n.r + 7)} fill={c.fill} opacity={0.35} />
                <circle
                  className="core"
                  cx={n.x}
                  cy={n.y}
                  r={Math.max(1, n.r)}
                  fill={c.fill}
                  stroke={isSel ? '#FFFFFF' : c.stroke}
                  strokeWidth={sw}
                  // 未识别策略的节点外描边改细虚线（附录 A2）：如实表达「这条判不了」，
                  // 与「无赞同数」的内环区分——外描边 vs 内环
                  strokeDasharray={unid ? '4 4' : undefined}
                />
                {approx && n.r > 12 && (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={Math.max(1, n.r - 5)}
                    fill="none"
                    stroke={c.stroke}
                    strokeWidth={1}
                    strokeOpacity={0.5}
                    strokeDasharray="3 3"
                    pointerEvents="none"
                  />
                )}
                {/* 圆内符号：立场色轴画策略符号（未识别则留空，不画兜底假符号）；
                    策略色轴下符号位改为立场首字（仅立场非中立时），策略名由文字位承担 */}
                {!unid &&
                  (byStrategy ? (
                    n.stance !== '中立' && (
                      <text
                        x={n.x}
                        y={hasText ? n.y - n.r * 0.26 : n.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={12}
                        fill={c.stroke}
                        fontWeight={500}
                      >
                        {n.stance[0]}
                      </text>
                    )
                  ) : (
                    <StrategyGlyph s={n.strategy} x={n.x} y={hasText ? n.y - n.r * 0.26 : n.y} color={c.stroke} />
                  ))}
                {hasText && !(byStrategy && unid) && (
                  <text
                    x={n.x}
                    y={n.y + n.r * 0.3}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.min(13, Math.max(11, n.r * 0.3))}
                    fill={c.text}
                    fontWeight={500}
                  >
                    {byStrategy ? n.strategy : n.stance}
                  </text>
                )}
                {lowConf && (
                  <g pointerEvents="none">
                    <circle cx={n.x + n.r * 0.72} cy={n.y - n.r * 0.72} r={6} fill="#0D1B2E" stroke="#8FA3BD" strokeWidth={1} />
                    <text x={n.x + n.r * 0.72} y={n.y - n.r * 0.72} textAnchor="middle" dominantBaseline="central" fontSize={9} fill="#8FA3BD">
                      ?
                    </text>
                  </g>
                )}
                {showTag && (
                  <text className="node-tag" x={n.x} y={n.y + n.r + 16} textAnchor="middle" fontSize={11.5} fill="#8FA3BD">
                    {unid ? '未识别' : n.strategy} · {n.votes ?? '热序'}
                  </text>
                )}
                <title>{`【${n.stance} · ${unid ? '未识别' : n.strategy}】${n.author}\n${n.summary || n.excerpt.slice(0, 80)}\n赞同 ${n.votes ?? '（按热序近似）'} · 评论 ${n.comments} · 权威等级 ${n.authority}`}</title>
              </g>
            );
          })}
        </svg>

        {/* 取景框四角刻度线：观测窗是「仪器」而非卡片，角标是最便宜的仪器感 */}
        <div className="tank-frame" aria-hidden="true">
          <i className="tl" />
          <i className="tr" />
          <i className="bl" />
          <i className="br" />
        </div>

        <div className="hud">
          <span className="hud-chip">{sourceLabel}</span>
          <span className="hud-chip">物种 <b>{nodes.length}</b></span>
          {dominant && (
            <span className="hud-chip">
              优势 <b>{dominant.stance}·{dominant.strategy}</b>
            </span>
          )}
          {/* 未识别计数显性化（附录 A2）：能诚实说「判不了」的模型比硬塞进六个格子的更可信 */}
          {unidentifiedCount > 0 && (
            <span className="hud-chip">
              未识别 <b>{unidentifiedCount}</b>
            </span>
          )}
          {resolved.some((l) => l.kind === 'rival') && <span className="hud-chip">虚线 = 对立竞争</span>}
        </div>

        {/* 图例与节点编码同步：主标题说明当前颜色编码的维度（随问题类型自适应），
            色块与符号都要能在这里查到 */}
        <div className="legend">
          <span className="legend-title">{byStrategy ? '颜色 = 生存策略（本题不预设对立立场）' : '颜色 = 观点立场'}</span>
          {(byStrategy ? STRATEGIES : STANCES).map((s) => {
            const c = byStrategy ? TANK_STRATEGY[s as Strategy] : TANK_STANCE[s as Stance];
            return (
              <span key={s}>
                <i style={{ background: c.fill, borderColor: c.stroke }} />
                {s}
              </span>
            );
          })}
          {!byStrategy &&
            STRATEGIES.map((s) => (
              <span key={s}>
                <svg width="12" height="12" viewBox="0 0 14 14" style={{ display: 'block' }}>
                  <StrategyGlyph s={s} x={7} y={7} color="#8FA3BD" />
                </svg>
                {s}
              </span>
            ))}
          {hasApprox && (
            <span>
              <svg width="14" height="14" viewBox="0 0 14 14" style={{ display: 'block' }}>
                <circle cx="7" cy="7" r="5.5" fill="none" stroke="#8FA3BD" strokeWidth="1" strokeDasharray="2.5 2.5" />
                <circle cx="7" cy="7" r="2.5" fill="none" stroke="#8FA3BD" strokeWidth="1" strokeDasharray="2 2" strokeOpacity="0.6" />
              </svg>
              虚线内环 = 无公开赞同数，按热序近似
            </span>
          )}
          {unidentifiedCount > 0 && (
            <span>
              <svg width="14" height="14" viewBox="0 0 14 14" style={{ display: 'block' }}>
                <circle cx="7" cy="7" r="5.5" fill="none" stroke="#8FA3BD" strokeWidth="1.2" strokeDasharray="3 3" />
              </svg>
              虚线外描边 = 未识别出显著生存策略
            </span>
          )}
          <span className="note">圆面积 = 能量 · 描边粗细 = 权威等级 · 点击物种查看详情</span>
        </div>
      </div>

      {selected && (
        <div className="detail-card">
          <div>
            <div className="name">
              【{selected.stance} · {isStrategyUnidentified(selected) ? '未识别' : selected.strategy}】{selected.summary || '（未标注）'}
              <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>　— {selected.author}</span>
              {selected.confidence < 0.15 && <span className="badge-warn" style={{ marginLeft: 8 }}>低置信</span>}
            </div>
            <p>{selected.excerpt}</p>
            <div className="meta-line">
              赞同 {selected.votes ?? '（按热序近似）'} · 评论 {selected.comments} · 发布/编辑 {selected.editTime > 0 ? new Date(selected.editTime * 1000).toLocaleDateString('zh-CN') : '未知'} · 权威等级 {selected.authority}
              {selected.badgeText ? ` · ${selected.badgeText}` : ''}
            </div>
            <EvidenceBlock s={selected} />
            {selected.featuredComments.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {selected.featuredComments.slice(0, 2).map((c, i) => (
                  <div key={i} className="quote">
                    精选评论：{c}
                  </div>
                ))}
              </div>
            )}
            <a
              href={selected.url}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              查看原文（知乎） <Icon.ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 判定依据（可解释标注，spec 第 3 节） ----------
// 这是产品最重要的差异化：每条标注都能追问「凭什么这么判」——
// 命中词 + 权重 + 按权重成比例的细条（纯色描边风格，不用渐变）。
function EvidenceBlock({ s }: { s: Species }) {
  const unid = isStrategyUnidentified(s);
  const ai = isAiSource(s.annotationSource);
  const srcLabel = ai
    ? `DeepSeek 语义判定 · ${aiSourceModel(s.annotationSource)}`
    : s.annotationSource === 'demo'
      ? '演示预设标签 · 非机器判定'
      : s.annotationSource === 'none'
        ? '标注缺失 · 无判定来源'
        : '本地可解释模型 · 零 API 消耗';
  // 「特征不足」是标注器的兜底占位词，不是真实命中词，不应带权重条展示
  const stanceEv = (s.evidence?.stance ?? []).filter((e) => e.term !== '特征不足').slice(0, 5);
  const strategyEv = (s.evidence?.strategy ?? []).filter((e) => e.term !== '特征不足').slice(0, 5);
  return (
    <div className="evidence-block">
      <div className="ev-head">
        <span>判定依据</span>
        <span className="ev-src">{srcLabel}</span>
      </div>
      {ai ? (
        <>
          {/* AI 判定没有「命中词权重」这回事：它的依据是一句语义解释。
              硬画权重条会造出一根恒为 100% 的假条，把判定依据变成装饰。 */}
          <div className="ev-row">
            <span className="ev-label">立场「{s.stance}」</span>
            <span className="ev-empty">{s.aiReason || '模型语义判定'}</span>
          </div>
          {unid && (
            <div className="ev-row">
              <span className="ev-label">策略</span>
              <span className="ev-empty">未识别（模型判定为无显著策略）</span>
            </div>
          )}
        </>
      ) : (
        <>
          <EvidenceRow label={`立场「${s.stance}」`} items={stanceEv} emptyText="（无显著立场信号）" />
          {unid ? (
            <div className="ev-row">
              <span className="ev-label">策略</span>
              <span className="ev-empty">未识别（无显著策略特征）</span>
            </div>
          ) : (
            <EvidenceRow label={`策略「${s.strategy}」`} items={strategyEv} emptyText="（无显著策略特征）" />
          )}
        </>
      )}
      {/* 低置信文案要诚实：两种来源的「低分」含义不同，不能共用一句话 */}
      {s.confidence < 0.15 && (
        <div className="ev-lowconf">
          {ai
            ? '模型自评置信度极低，该判定仅供参考 · 不代表该回答真的中立'
            : '特征不足，已回落为中立 · 不代表该回答真的中立'}
        </div>
      )}
    </div>
  );
}

function EvidenceRow({
  label,
  items,
  emptyText,
}: {
  label: string;
  items: { term: string; weight: number }[];
  emptyText: string;
}) {
  // 权重条按行内最大权重归一：条长只在同一行内可比，不跨行误导
  const maxW = Math.max(0.0001, ...items.map((e) => e.weight));
  return (
    <div className="ev-row">
      <span className="ev-label">{label}</span>
      {items.length === 0 ? (
        <span className="ev-empty">{emptyText}</span>
      ) : (
        <span className="ev-items">
          {items.map((e, i) => (
            <span className="ev-item" key={i}>
              <b>{e.term}</b>
              <span className="ev-w">{e.weight}</span>
              <span className="ev-bar">
                <i style={{ width: `${Math.round((e.weight / maxW) * 100)}%` }} />
              </span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
