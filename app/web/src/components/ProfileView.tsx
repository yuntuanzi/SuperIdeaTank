import { useEffect, useState } from 'react';
import { api } from '../api';
import type { OAuthStatus, ProfileSample, SpeciesProfile, Stance, Strategy } from '../types';
import { STANCES, STRATEGIES, STANCE_COLORS } from '../types';
import { StrategyGlyph } from './Tank';
import { Icon } from './Icon';

// 「我的观点画像」：用户授权知乎账号后，读他自己的创作，
// 用与生态缸完全同一套「立场 × 生存策略」模型分析他本人属于哪种观点物种。
// 配色复用立场的浅底深描边体系；策略色与深色观测窗的 TANK_STRATEGY 同色相，
// 只是换成浅色面板适配（这里背景是浅色而非缸体深色）。

// 与 Tank.tsx TANK_STRATEGY 同色相（12/60/120/180/240/300）的浅色版：
// 同一策略在两个视图里色相一致，用户可以把「缸里的别人」和「画像里的自己」对上号
const STRATEGY_COLORS: Record<Strategy, { fill: string; stroke: string; text: string }> = {
  数据论证: { fill: '#E7EBFB', stroke: '#4A5DB0', text: '#35447F' }, // 蓝 ~240°
  情绪共鸣: { fill: '#FAECE7', stroke: '#993C1D', text: '#712B13' }, // 橙红 ~12°
  故事叙事: { fill: '#F4EFD8', stroke: '#8A7220', text: '#665318' }, // 黄 ~60°
  身份站队: { fill: '#E4F3E8', stroke: '#2E7D43', text: '#1F5A30' }, // 绿 ~120°
  抖机灵: { fill: '#DFF3F1', stroke: '#177A70', text: '#0E5A53' }, // 青 ~180°
  引用权威: { fill: '#F4E6F3', stroke: '#8E3B84', text: '#692B62' }, // 品红 ~300°
};

export function ProfileView({ oauth }: { oauth: OAuthStatus | null }) {
  const [profile, setProfile] = useState<SpeciesProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [thinking, setThinking] = useState('');

  const authorized = Boolean(oauth?.authorized);

  useEffect(() => {
    if (!authorized) return;
    setLoading(true);
    setError('');
    api
      .profileSpecies()
      .then(setProfile)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [authorized]);

  // 未授权：解释这个功能是什么 + 授权入口（授权必须用户本人点击，整页跳转而非代发请求）
  if (!authorized) {
    return (
      <div className="profile-empty panel-card">
        <h2>我的观点画像</h2>
        <p>
          授权知乎账号后，读取你最近的公开创作，用与生态缸同一套「立场 × 生存策略」模型
          分析你自己属于哪种观点物种。授权将在知乎官方页面完成，本站拿不到你的密码。
        </p>
        <OAuthGate oauth={oauth} />
      </div>
    );
  }

  if (loading) return <div className="panel-card"><div className="loading">正在读取你的公开创作并分析…</div><div className="narrative" aria-live="polite">{thinking || 'DeepSeek 正在分析你的公开创作…'}</div></div>;
  if (error) return <div className="err">{error}</div>;
  if (!profile) return null;

  // 空创作（新号/无公开内容）是正常结果，不是报错页（spec 3.3 第 6 条）
  if (profile.total === 0) {
    return (
      <div className="profile-empty panel-card">
        <h2>我的观点画像</h2>
        <p>你的公开创作还不够做画像。发布几条回答或文章后再来看看。</p>
        <FooterNote total={0} />
      </div>
    );
  }

  return (
    <div className="profile-view">
      <div className="panel-card profile-hero">
        <div className="profile-verdict">
          你在知乎是一个
          <b style={{ color: STRATEGY_COLORS[profile.dominantStrategy ?? '数据论证'].text }}>
            「{profile.dominantStrategy ?? '—'}型」
          </b>
          物种
        </div>
        <div className="profile-sub">
          主导立场 <b>{profile.dominantStance ?? '—'}</b> · 主导策略 <b>{profile.dominantStrategy ?? '—'}</b>
          {profile.unidentified > 0 && <span className="stat-chip">未识别策略 {profile.unidentified} 条</span>}
        </div>
      </div>

      <div className="panel-card">
        <h3 className="profile-section-title">生存策略分布</h3>
        <DistBars
          entries={STRATEGIES.map((s) => ({ label: s, count: profile.strategyDist[s], colors: STRATEGY_COLORS[s], glyph: s }))}
          total={profile.total - profile.unidentified}
        />
        {profile.unidentified > 0 && (
          <div className="profile-unid">另有 {profile.unidentified} 条未识别出显著策略 —— 如实标注，不硬塞进六个格子</div>
        )}
      </div>

      <div className="panel-card">
        <h3 className="profile-section-title">观点立场分布</h3>
        <DistBars
          entries={STANCES.map((s) => ({ label: s, count: profile.stanceDist[s], colors: STANCE_COLORS[s] }))}
          total={profile.total}
        />
      </div>

      {profile.samples.length > 0 && (
        <div className="panel-card">
          <h3 className="profile-section-title">判定样本（按置信度取前 {profile.samples.length} 条）</h3>
          {profile.samples.map((s, i) => (
            <SampleCard key={i} sample={s} />
          ))}
        </div>
      )}

      <FooterNote total={profile.total} cached={profile.cached} />
    </div>
  );
}

// 授权入口的三态：未配回调（禁用+说明）/ 可授权 / 已授权由父级顶栏接管，这里只管前两种
function OAuthGate({ oauth }: { oauth: OAuthStatus | null }) {
  if (!oauth) return <div className="loading">正在检查授权配置…</div>;
  if (!oauth.callbackConfigured) {
    return (
      <div>
        <button className="oauth-btn" disabled title="等待部署后开放">
          授权知乎账号
        </button>
        <span className="oauth-hint">等待部署后开放：本地地址无法完成知乎登录</span>
      </div>
    );
  }
  // 整页跳转走 302，不在 fetch 里发起：授权页必须由用户本人在知乎域名下完成确认
  return (
    <button className="oauth-btn" onClick={() => (window.location.href = '/api/oauth/start')}>
      授权知乎账号
    </button>
  );
}

function DistBars({
  entries,
  total,
}: {
  entries: { label: string; count: number; colors: { fill: string; stroke: string; text: string }; glyph?: Strategy }[];
  total: number;
}) {
  const max = Math.max(1, ...entries.map((e) => e.count));
  return (
    <div className="dist">
      {entries.map((e) => (
        <div className="dist-row" key={e.label}>
          <span className="dist-label">
            {e.glyph && (
              <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
                <StrategyGlyph s={e.glyph} x={7} y={7} color={e.colors.stroke} />
              </svg>
            )}
            {e.label}
          </span>
          <span className="dist-bar">
            {/* 条长按行内最大值归一：只做组内对比，不跨组误导 */}
            <i style={{ width: `${Math.round((e.count / max) * 100)}%`, background: e.colors.fill, borderColor: e.colors.stroke }} />
          </span>
          <span className="dist-count">
            {e.count} 条{total > 0 ? ` · ${Math.round((e.count / total) * 100)}%` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function SampleCard({ sample }: { sample: ProfileSample }) {
  // 展开态交给原生 <details>：零 JS 状态、键盘可访问，也不引入循环动画
  const strategyUnidentified = sample.evidence.strategy.length === 0 || sample.evidence.strategy[0]?.term === '特征不足';
  return (
    <details className="sample-card">
      <summary>
        {/* 展开箭头用 SVG 旋转 90° 表达（原 ▸/▾ 字符已替换），展开态染主色 */}
        <span className="sample-caret">
          <Icon.ChevronRight size={13} />
        </span>
        <span className="sample-title">{sample.title || '（无标题）'}</span>
        <span className="sample-chips">
          <span className="stat-chip">{sample.stance}</span>
          <span className="stat-chip">{strategyUnidentified ? '策略未识别' : sample.strategy}</span>
          <span className="stat-chip">置信 {(sample.confidence * 100).toFixed(0)}%</span>
        </span>
      </summary>
      <div className="evidence-block">
        <EvidenceRow label={`立场「${sample.stance}」`} items={filterEvidence(sample.evidence.stance)} />
        {strategyUnidentified ? (
          <div className="ev-row">
            <span className="ev-label">策略</span>
            <span className="ev-empty">未识别（无显著策略特征）</span>
          </div>
        ) : (
          <EvidenceRow label={`策略「${sample.strategy}」`} items={filterEvidence(sample.evidence.strategy)} />
        )}
      </div>
      {sample.url && (
        <a href={sample.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--primary)' }}>
          查看原文（知乎） <Icon.ExternalLink size={11} />
        </a>
      )}
    </details>
  );
}

// 「特征不足」是标注器的兜底占位词，不是真实命中词，与 Tank 的证据块同口径过滤
function filterEvidence(items: { term: string; weight: number }[]) {
  return (items || []).filter((e) => e.term !== '特征不足').slice(0, 5);
}

// 复用生态缸证据块的行结构与 CSS 类（evidence-block/ev-row/ev-item/ev-bar），
// 用户在画像页看到的判定依据和缸里点开的每条回答是同一种语言
function EvidenceRow({ label, items }: { label: string; items: { term: string; weight: number }[] }) {
  const maxW = Math.max(0.0001, ...items.map((e) => e.weight));
  return (
    <div className="ev-row">
      <span className="ev-label">{label}</span>
      {items.length === 0 ? (
        <span className="ev-empty">（无显著信号）</span>
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

function FooterNote({ total, cached }: { total: number; cached?: boolean }) {
  return (
    <p className="profile-footer">
      基于你最近 {total} 条公开创作 · 数据来自知乎开放平台用户数据接口 · 仅你本人可见
      {cached ? ' · 30 分钟内结果复用缓存' : ''}
    </p>
  );
}
