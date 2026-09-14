export const STANCES = ['支持', '反对', '中立', '解构', '反讽', '补充'] as const;
// 这六个是**可配色**的策略。服务端还可能给出 '未识别' —— 它不是一个第七种策略，
// 而是「这条判不了」的诚实声明，因此不进这个联合类型：
// 界面上一律走 isStrategyUnidentified() 的未识别分支（无彩色 + 虚线内环），
// 避免为它编造一套配色，让它看起来像个真实判定。
export const STRATEGIES = ['数据论证', '情绪共鸣', '故事叙事', '身份站队', '抖机灵', '引用权威'] as const;
// 服务端在枚举与本地标注器里使用的「未识别」字面量
export const UNIDENTIFIED = '未识别';

export type Stance = (typeof STANCES)[number];
export type Strategy = (typeof STRATEGIES)[number];

export interface Species {
  id: string;
  title: string;
  excerpt: string;
  author: string;
  badgeText?: string;
  authority: number;
  votes: number | null; // null = question_answers 通道无赞同数字段，能量按热序近似
  enriched?: boolean; // 赞同数经 LCS 匹配自搜索接口
  comments: number;
  editTime: number; // unix 秒；0 = 未知
  heatRank?: number; // 能量近似序（越大越热）
  url: string;
  featuredComments: string[];
  stance: Stance;
  strategy: Strategy;
  summary: string;
  // 区分 AI 语义判定、本地词典命中、预设演示与缺失标签，让 UI 能如实说明判断来源。
  // AI 来源统一写成 `deepseek:<model>`，前端用前缀判断即可，不必硬编码模型名。
  annotationSource: 'local-heuristic' | 'demo' | 'none' | `deepseek:${string}`;
  // AI 判定时为一句可读的判定依据（模型给出的语言信号），本地判定时为 null
  aiReason?: string | null;
  confidence: number;
  evidence: {
    stance: { term: string; weight: number }[];
    strategy: { term: string; weight: number }[];
  };
}

export interface Ecosystem {
  question: string;
  questionUrl?: string;
  source: 'live' | 'demo';
  dataSource?: 'question_answers' | 'search';
  createdAt: number;
  species: Species[];
  narrative: string;
  // 原文独立于解析结果，格式漂移时前端仍能展示已取得的解说。
  aiNarrative: string | null;
  aiNarrativeSource: string | null;
  aiNarrativeError?: string;
  annotationWarning?: string | null;
  aiFactions: { name: string; claim: string; persuasion: string }[] | null;
  aiDominant: string | null;
  // 本缸物种标注主要来自谁：`deepseek:<model>` = AI 语义判定，`local-heuristic` = 本地词典
  annotationSource?: string;
  // 问题类型由 AI 判定、失败回落本地句式规则；决定色轴用立场还是策略
  questionType?: 'judgement' | 'why' | 'howto' | 'open';
  questionTypeSource?: string;
  // 赞同数富化覆盖率（question_answers 无赞同数，靠同题搜索补齐）
  enrichment?: {
    enriched: number;
    total: number;
    fromAnswers: number;
    fromGlobalSearch: number;
    strategy: string;
  };
  cached?: boolean;
  note?: string;
}

export interface ReleaseReport {
  stance: Stance;
  strategy: Strategy;
  summary: string;
  survivalProbability: number;
  ruleProbability: number;
  aiProbability: number | null;
  suppressedBy: string;
  risks: string[];
  // AI 追加：最可能出现的反驳（规则模型不产出这一项）
  rebuttals: string[];
  attractComments: string[];
  hybridAdvice: string[];
  narrative: string;
  // AI 只追加文字点评，来源值不能再暗示它参与数值概率计算。
  analysisSource: 'rule+local' | 'rule+local+ai' | 'rule-only-demo';
  aiComment: string | null;
  // AI 点评的来源标识（`deepseek:<model>`）；未调用时为 null
  aiInsightSource: string | null;
  simulatedAt: number;
}

export interface HotItem {
  title: string;
  url: string;
  summary: string;
  thumbnail: string;
}

// ---- 流式构建事件（POST /api/ecosystem/stream 的 SSE 载荷）----
// 服务端把「汇聚样本 → AI 逐条识别 → 派系归纳」的全过程按事件推下来，
// 前端据此把等待过程展示给用户，而不是干等一个几十秒的空白页。
export type BuildEvent =
  | { type: 'stage'; key: string; label: string; state: 'start' | 'done'; detail?: string }
  | { type: 'log'; text: string }
  // AI 的思考过程增量（推理模型先吐 reasoning_content 再吐正文）
  | { type: 'reasoning'; text: string; stage?: string }
  | { type: 'result'; data: Ecosystem }
  | { type: 'end' }
  | { type: 'error'; message: string; code?: string | number };

// ---- 知乎 OAuth + 我的观点画像（2026-09-13 新增，既有字段未动）----

// 前端能看到的只有授权态布尔值与展示用 profile；app_key / token 永远不会出现在这里
export interface OAuthProfile {
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  url: string | null;
}

export interface OAuthStatus {
  configured: boolean; // app_key + Access Secret + 回调地址三者齐备
  callbackConfigured: boolean; // 仅回调地址已配置（决定授权按钮是否可点）
  authorized: boolean;
  appId: string | null;
  redirectUri: string | null;
  profile: OAuthProfile | null;
  stateVerified: boolean | null; // 回调是否带了 state（实测可能不带，必须如实展示）
  expiresAt: string | null;
  error: { code: string; message: string } | null;
}

export interface ProfileSample {
  title: string;
  url: string;
  stance: Stance;
  strategy: Strategy;
  confidence: number;
  evidence: {
    stance: { term: string; weight: number }[];
    strategy: { term: string; weight: number }[];
  };
}

// GET /api/profile/species 的响应：用户本人的观点物种画像
export interface SpeciesProfile {
  total: number; // 实际分析的条数；0 = 公开创作不足，不是错误
  dominantStrategy: Strategy | null;
  dominantStance: Stance | null;
  strategyDist: Record<Strategy, number>;
  stanceDist: Record<Stance, number>;
  samples: ProfileSample[];
  unidentified: number; // 没识别出显著策略的条数（兜底标签不计入分布）
  analyzedAt: number;
  cached?: boolean;
}

export interface EnvParams {
  rankMode: 'votes' | 'recent';
  climate: 'rational' | 'emotional';
  authorityBoost: boolean;
}

// 标注来源判定：服务端统一用 `deepseek:<model>` 前缀，前端只认前缀不认具体模型名，
// 换模型（flash / pro / 未来的版本）时界面不需要跟着改。
export function isAiSource(source?: string | null): boolean {
  return typeof source === 'string' && source.startsWith('deepseek:');
}

// 从来源标识里取出可展示的模型名；非 AI 来源返回空串。
export function aiSourceModel(source?: string | null): string {
  return isAiSource(source) ? String(source).slice('deepseek:'.length) : '';
}

export const STANCE_COLORS: Record<Stance, { fill: string; stroke: string; text: string }> = {
  支持: { fill: '#E6F1FB', stroke: '#185FA5', text: '#0C447C' },
  反对: { fill: '#FAECE7', stroke: '#993C1D', text: '#712B13' },
  中立: { fill: '#F1EFE8', stroke: '#888780', text: '#444441' },
  解构: { fill: '#E1F5EE', stroke: '#0F6E56', text: '#085041' },
  反讽: { fill: '#EEEDFE', stroke: '#534AB7', text: '#3C3489' },
  补充: { fill: '#EAF3DE', stroke: '#3B6D11', text: '#27500A' },
};

// 深色生态缸画布用：半透明填充 + 亮描边（扁平，无渐变）
export const STANCE_DARK: Record<Stance, { fill: string; stroke: string; text: string }> = {
  支持: { fill: 'rgba(66, 133, 244, 0.20)', stroke: '#7FAAF0', text: '#A8C8F5' },
  反对: { fill: 'rgba(224, 110, 74, 0.20)', stroke: '#E89A7E', text: '#F0BBA6' },
  中立: { fill: 'rgba(150, 160, 175, 0.18)', stroke: '#A8B2C0', text: '#C4CCD8' },
  解构: { fill: 'rgba(46, 196, 143, 0.18)', stroke: '#7FD8B8', text: '#A8E5CF' },
  反讽: { fill: 'rgba(139, 125, 224, 0.22)', stroke: '#A79DE8', text: '#C6BFF2' },
  补充: { fill: 'rgba(118, 190, 66, 0.20)', stroke: '#9BD37E', text: '#BFE5A8' },
};
