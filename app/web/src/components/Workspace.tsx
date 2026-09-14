import { useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { api } from '../api';
import type { EnvParams, Ecosystem, ReleaseReport, Species } from '../types';
import { aiSourceModel } from '../types';
import { buildReportSvg, downloadPng, downloadSvg } from '../lib/report';
import { Icon } from './Icon';
import type { IconProps } from './Icon';

type Tab = 'timeline' | 'env' | 'release' | 'report';

// 四个 Tab 各配一个 stroke 图标：与首页能力卡共用同一套图标语言
// （时间轴=时钟 / 干预=滑杆 / 放生=烧瓶 / 报告=文档）
const TABS: { key: Tab; label: string; icon: ComponentType<IconProps> }[] = [
  { key: 'timeline', label: '演化时间轴', icon: Icon.History },
  { key: 'env', label: '环境干预', icon: Icon.Sliders },
  { key: 'release', label: '放生实验', icon: Icon.Flask },
  { key: 'report', label: '生态报告', icon: Icon.Report },
];

export function Workspace({
  eco,
  sorted,
  timeIdx,
  onTimeIdx,
  params,
  onParams,
  release,
  onRelease,
}: {
  eco: Ecosystem;
  sorted: Species[];
  timeIdx: number;
  onTimeIdx: (n: number) => void;
  params: EnvParams;
  onParams: (p: EnvParams) => void;
  release: ReleaseReport | null;
  onRelease: (r: ReleaseReport | null) => void;
}) {
  const [tab, setTab] = useState<Tab>('timeline');

  return (
    <div className="panel">
      <div className="segmented">
        {TABS.map(({ key, label, icon: TabIcon }) => (
          <button key={key} className={`seg-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            <TabIcon size={13} />
            {label}
          </button>
        ))}
      </div>
      <div className="panel-card">
        {tab === 'timeline' && <TimelinePanel sorted={sorted} timeIdx={timeIdx} onTimeIdx={onTimeIdx} />}
        {tab === 'env' && <EnvPanel params={params} onParams={onParams} />}
        {tab === 'release' && (
          <ReleasePanel eco={eco} report={release} onReport={onRelease} visible={sorted.slice(0, Math.max(1, timeIdx))} />
        )}
        {tab === 'report' && <ReportPanel eco={eco} release={release} />}
      </div>
      {/* AI 生态解说常驻右栏底部（spec 第 4 节）：四个 tab 之外的常驻区块，
          填掉 1440 下右栏空白；三种状态都如实展示，没有解说也不隐藏 */}
      <NarrativeBlock eco={eco} />
    </div>
  );
}

// ---------- AI 生态解说（整缸派系归纳，与逐条标注互为独立路径） ----------

function NarrativeBlock({ eco }: { eco: Ecosystem }) {
  // 来源一律从数据里读，不再硬编码模型名：换装 DeepSeek 后写死旧模型名会让
  // 界面撒谎（明明是新模型却标着旧模型）。没有来源就如实说没有。
  const src = eco.aiNarrativeSource;
  const model = aiSourceModel(src);
  const srcBadge = src ? `DeepSeek · ${model}` : '未生成';
  const srcNote = src
    ? '由 DeepSeek 生成 · 与左侧逐条标注为两条独立路径，可互相印证'
    : '本缸未生成 AI 解说 · 左侧逐条标注不受影响';
  return (
    <div className="panel-card narrative-block">
      <div className="panel-title">
        <span>AI 生态解说</span>
        <span className="badge-info">{srcBadge}</span>
      </div>
      {eco.aiFactions && eco.aiFactions.length > 0 ? (
        <>
          {/* 派系序号用大号 tabular-nums，与热榜列表的编号风格一致 */}
          {eco.aiFactions.map((f, i) => (
            <div className="faction" key={i}>
              <span className="faction-idx">{String(i + 1).padStart(2, '0')}</span>
              <div className="faction-body">
                <div className="faction-name">{f.name}</div>
                <div className="faction-claim">代表观点：{f.claim}</div>
                <div className="faction-persuasion">说服方式：{f.persuasion}</div>
              </div>
            </div>
          ))}
          {eco.aiDominant && (
            <div className="faction-dominant">
              <span className="ev-label">谁占上风</span>
              {eco.aiDominant}
            </div>
          )}
          {/* 双通道叙事是产品说明的核心，这行小字不要删 */}
          <p className="tiny-note">{srcNote}</p>
        </>
      ) : eco.aiNarrative ? (
        <>
          {/* 原文独立于结构解析：解析未命中时仍展示已取得的解说，不丢内容 */}
          <div className="badge-warn" style={{ marginBottom: 8 }}>AI 解说原文（结构解析未命中）</div>
          <div className="narrative-raw">{eco.aiNarrative}</div>
          <p className="tiny-note">{srcNote}</p>
        </>
      ) : (
        <>
          {/* 不编造缺省原因：只如实说没生成，并把真实错误（若有）原样给出 */}
          <div className="narrative-empty">本缸暂无 AI 生态解说。左侧逐条标注不受影响。</div>
          {eco.aiNarrativeError && <div className="ev-empty" style={{ marginTop: 6 }}>原因：{eco.aiNarrativeError}</div>}
        </>
      )}
    </div>
  );
}

// ---------- 演化时间轴 ----------

function TimelinePanel({
  sorted,
  timeIdx,
  onTimeIdx,
}: {
  sorted: Species[];
  timeIdx: number;
  onTimeIdx: (n: number) => void;
}) {
  if (!sorted.length) return <div className="loading">无数据</div>;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const cur = sorted[Math.min(timeIdx, sorted.length) - 1];
  const fmt = (s: Species) => (s.editTime > 0 ? new Date(s.editTime * 1000).toLocaleDateString('zh-CN') : '时间未知');

  return (
    <div>
      <div className="panel-title">
        <span>观点入场演化</span>
        <span className="badge-warn">AI 演化重建 · 非历史记录</span>
      </div>
      <input
        className="timeline-slider"
        type="range"
        min={1}
        max={sorted.length}
        value={Math.min(timeIdx, sorted.length)}
        onChange={(e) => onTimeIdx(Number(e.target.value))}
      />
      <div className="timeline-meta">
        <span>{fmt(first)}</span>
        <span>
          {Math.min(timeIdx, sorted.length)} / {sorted.length} 已入场
        </span>
        <span>{fmt(last)}</span>
      </div>
      {cur && (
        <div className="timeline-box">
          最新入场：【{cur.stance} · {cur.strategy}】{cur.summary || cur.author}（{cur.votes ?? '热序'}）
        </div>
      )}
      <p className="tiny-note">
        官方 API 仅提供当前时点数据。本时间轴基于回答发布/编辑时间排序重演入场过程，趋势为推演示意，不代表真实历史赞同曲线。
      </p>
    </div>
  );
}

// ---------- 环境干预 ----------

function EnvPanel({ params, onParams }: { params: EnvParams; onParams: (p: EnvParams) => void }) {
  return (
    <div>
      <div className="panel-title">
        <span>改变缸的规则，看谁能活下来</span>
        <span className="badge-info">实时重算</span>
      </div>
      <div className="field">
        <label>推荐算法权重</label>
        <select value={params.rankMode} onChange={(e) => onParams({ ...params, rankMode: e.target.value as EnvParams['rankMode'] })}>
          <option value="votes">高赞优先（能量 = 赞同数）</option>
          <option value="recent">新回答优先（能量 = 时近度）</option>
        </select>
      </div>
      <div className="field">
        <label>情绪气候</label>
        <select value={params.climate} onChange={(e) => onParams({ ...params, climate: e.target.value as EnvParams['climate'] })}>
          <option value="rational">理性优先（论证类加权）</option>
          <option value="emotional">情绪优先（共鸣 / 故事 / 机灵加权）</option>
        </select>
      </div>
      <div className="toggle-row">
        <span>权威等级加权（大 V 效应）</span>
        <label className="switch">
          <input type="checkbox" checked={params.authorityBoost} onChange={(e) => onParams({ ...params, authorityBoost: e.target.checked })} />
          <span className="track" />
          <span className="knob" />
        </label>
      </div>
      <p className="tiny-note">
        同一个问题，在不同的平台规则下，胜出的观点物种完全不同。此为本地可解释模型，零 API 消耗。
      </p>
    </div>
  );
}

// ---------- 放生实验 ----------

const DRAFT_SEEDS: [string, string][] = [
  ['反对 · 数据论证', '我整理了近三年所在行业的工时与产出数据：加班最严重的季度，人均有效产出反而下降了两成。无效加班不是奋斗，是把工位当成了秀场。'],
  ['支持 · 故事叙事', '毕业第一年，我每天最后一个离开工位。直到有天凌晨十一点，我发现自己改的第三版方案，和第一版一模一样。那一刻我明白，疲惫不等于成长。'],
  ['解构 · 抖机灵', '大家反感的不是加班，是领导没走自己不敢走。建议所有公司把「下班时间」和「表演时间」在制度上分开核算，问题就解决了一半。'],
];

function ReleasePanel({
  eco,
  report,
  onReport,
  visible,
}: {
  eco: Ecosystem;
  report: ReleaseReport | null;
  onReport: (r: ReleaseReport | null) => void;
  visible: Species[];
}) {
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.release(eco.question, draft.trim(), visible);
      onReport(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="panel-title">
        <span>往缸里放生一段你的回答</span>
        <span className="badge-warn">AI 模拟预测</span>
      </div>
      <div className="chip-row">
        {DRAFT_SEEDS.map(([label, text]) => (
          <button key={label} className="chip" onClick={() => setDraft(text)}>
            {label}
          </button>
        ))}
        {draft && (
          <button className="chip" onClick={() => setDraft('')}>
            清空
          </button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="写下你想发布到这个问题下的回答草稿（至少 20 字），AI 将模拟它在当前生态中的命运…"
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {draft.trim().length} 字 · 基于缸内 {visible.length} 个物种推演
        </span>
        <button className="btn primary" disabled={loading || draft.trim().length < 20} onClick={submit}>
          {loading ? '推演中…' : '放生'}
        </button>
      </div>
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {report && <ReportCard report={report} />}
    </div>
  );
}

function Gauge({ p }: { p: number }) {
  // 深底适配：存活=青绿 / 观察=琥珀 / 濒危=珊瑚，三档都提亮一档保证对比度
  const color = p >= 50 ? '#4ecfa8' : p >= 25 ? '#e0b25c' : '#e8836a';
  const r = 30;
  const circ = 2 * Math.PI * r;
  const filled = (p / 100) * circ * 0.75; // 3/4 弧
  const arcPath = (frac: number) => {
    const cx = 40;
    const cy = 40;
    const start = 135;
    const end = start + 270 * frac;
    const rad = (d: number) => (d * Math.PI) / 180;
    const sx = cx + r * Math.cos(rad(start));
    const sy = cy + r * Math.sin(rad(start));
    const ex = cx + r * Math.cos(rad(end));
    const ey = cy + r * Math.sin(rad(end));
    const large = 270 * frac > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  };
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" style={{ flex: 'none' }} role="img" aria-label={`存活概率 ${p}%`}>
      <path d={arcPath(1)} fill="none" stroke="var(--line-strong)" strokeWidth="6" strokeLinecap="round" />
      <path d={arcPath(p / 100)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      {/* 概率数字放大到 28px：它是整张报告卡的视觉锚点，原来的 16px 撑不起层级 */}
      <text className="prob-num" x="40" y="40" textAnchor="middle" dominantBaseline="central" fontSize="28" fontWeight="500" fill={color}>
        {p}%
      </text>
      {/* 3/4 圆弧的缺口正好在底部，把「存活概率」标注放进去，不额外占布局高度 */}
      <text x="40" y="72" textAnchor="middle" fontSize="10" fill="var(--ink-3)">
        存活概率
      </text>
    </svg>
  );
}

function ReportCard({ report }: { report: ReleaseReport }) {
  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <div className="gauge-row">
        <Gauge p={report.survivalProbability} />
        <div style={{ minWidth: 0 }}>
          {/* 概率来源必须如实可视化。早期版本画的是「AI : 规则 = 6 : 4 混合」的
              两段条，但 AI 现已被隔离在数值之外（aiProbability 恒为 null），
              那段 60% 的色块等于给一个不存在的贡献画图 —— 属于诚信红线，已去掉。 */}
          <div className="mix-bar" role="img" aria-label={`存活概率 ${report.ruleProbability}% 全部由规则模型产出，AI 不参与数值`}>
            <span className="seg-rule" style={{ width: '100%' }}>
              规则模型 {report.ruleProbability}
            </span>
          </div>
          <div className="prob-label">规则模型 100% · AI 不参与数值</div>
          <div className="verdict">{report.narrative}</div>
          <div style={{ marginTop: 8 }}>
            <span className="badge-info">
              {report.stance} · {report.strategy}
            </span>
          </div>
        </div>
      </div>
      <div className="report-block">
        <div className="bt">压制来源</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{report.suppressedBy}</div>
      </div>
      {report.aiComment && (
        <div className="report-block">
          {/* AI 点评独立成块 + 显式徽标：它与上面的概率不是同一种东西，
              不能混在一起让人误以为概率里含 AI 判断 */}
          <div className="bt">
            AI 模拟预测点评
            <span className="badge-warn" style={{ marginLeft: 6 }}>AI 模拟预测 · 非平台数据</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{report.aiComment}</div>
          {report.aiInsightSource && <div className="tiny-note">来源：{report.aiInsightSource}</div>}
        </div>
      )}
      {report.rebuttals && report.rebuttals.length > 0 && (
        <div className="report-block">
          <div className="bt">最可能的反驳</div>
          <ul className="report-list strip">
            {report.rebuttals.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {report.risks.length > 0 && (
        <div className="report-block">
          <div className="bt">风险</div>
          {/* 左侧 2px 暖色条：风险条目在列表层面就能被一眼认出 */}
          <ul className="report-list strip">
            {report.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {report.attractComments.length > 0 && (
        <div className="report-block">
          <div className="bt">可能吸引的评论</div>
          <ul className="report-list">
            {report.attractComments.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {report.hybridAdvice.length > 0 && (
        <div className="report-block">
          <div className="bt">杂交建议（提升存活率）</div>
          {/* 左侧 2px 主色条：与风险（暖色）形成「警示 / 引导」的色彩分工 */}
          <ul className="report-list strip advice">
            {report.hybridAdvice.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="fine-print">
        数值（存活概率 / 风险 / 杂交建议）全部由公开的可解释规则模型产出，AI 不参与计算；
        AI 仅追加文字点评与预测性评论，非知乎平台数据。概率公式见项目文档。
      </div>
    </div>
  );
}

// ---------- 生态报告 ----------

function ReportPanel({ eco, release }: { eco: Ecosystem; release: ReleaseReport | null }) {
  const svg = useMemo(
    () => buildReportSvg(eco, release, eco.source === 'live' ? '知乎开放平台实时检索' : '内置演示数据集'),
    [eco, release],
  );
  const fname = `观点进化图谱-${new Date().toISOString().slice(0, 10)}`;
  return (
    <div>
      <div className="panel-title">
        <span>生成可分享的「观点进化图谱」</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn" onClick={() => downloadSvg(svg, `${fname}.svg`)}>
          <Icon.Download size={13} /> 下载 SVG
        </button>
        <button className="btn" onClick={() => downloadPng(svg, `${fname}.png`)}>
          <Icon.Download size={13} /> 下载 PNG
        </button>
      </div>
      <div className="report-preview">
        <div dangerouslySetInnerHTML={{ __html: svg }} style={{ width: '100%' }} />
      </div>
      <p className="tiny-note">
        报告含物种能量排行、生存策略分布{release ? '、放生实验结果' : ''}与数据来源水印，可直接分享到知乎形成二次讨论。
      </p>
    </div>
  );
}
