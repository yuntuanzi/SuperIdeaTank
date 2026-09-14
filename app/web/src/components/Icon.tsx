import type { ComponentType, CSSProperties, ReactNode } from 'react';

// SVG stroke 图标系统：24×24 视窗、1.8px 圆头描边、继承 currentColor。
// 设计红线：禁止用 emoji / 文字字符（← ▸ ▾ ⚠）当图标，全部走这套矢量描边图标，
// 与「扁平 + 细描边卡片」的视觉语言同构。尺寸由 size 控制，颜色跟随文字 color，
// aria-hidden 因为所有图标都是装饰性伴随文字出现，不单独承载语义。

export type IconProps = { size?: number; className?: string; style?: CSSProperties };

function Svg({ size = 16, className, style, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      style={{ width: size, height: size, flex: 'none', ...style }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </Svg>
);

const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18l6-6-6-6" />
  </Svg>
);

const AlertTriangle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);

const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </Svg>
);

const ExternalLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
  </Svg>
);

const User = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
);

const LogOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </Svg>
);

const History = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

const Sliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21V14" />
    <path d="M4 10V3" />
    <path d="M12 21V12" />
    <path d="M12 8V3" />
    <path d="M20 21V16" />
    <path d="M20 12V3" />
    <path d="M1 14h6" />
    <path d="M9 8h6" />
    <path d="M17 16h6" />
  </Svg>
);

const Flask = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2v7.5a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45L14.21 10.4a2 2 0 0 1-.21-.9V2" />
    <path d="M8.5 2h7" />
    <path d="M7 16h10" />
  </Svg>
);

const Report = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </Svg>
);

const Download = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </Svg>
);

const Target = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </Svg>
);

// 构建进度的三个状态图标：等待（空心圈）/ 进行中（四分之三环）/ 完成复用 Check。
// 刻意不做转圈动画 —— 旋转是循环装饰动画，属于设计红线；
// 「还在动」由旁边的计时秒数如实表达，而不是靠一个转个不停的圈。
const Circle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
  </Svg>
);

const RingPartial = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" opacity="0.3" />
    <path d="M12 4a8 8 0 0 1 8 8" />
  </Svg>
);

const X = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </Svg>
);

// 「模型正在思考」的区块标题图标
const Sparkles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 3l1.5 4.1L16.6 8.6l-4.1 1.5L11 14.2 9.5 10.1 5.4 8.6l4.1-1.5z" />
    <path d="M18 15l.75 2.05L20.8 17.8l-2.05.75L18 20.6l-.75-2.05L15.2 17.8l2.05-.75z" />
  </Svg>
);

const Brain = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z" />
  </Svg>
);

export const Icon: Record<string, ComponentType<IconProps>> = {
  ArrowLeft,
  ChevronRight,
  AlertTriangle,
  Check,
  Search,
  ExternalLink,
  User,
  LogOut,
  History,
  Sliders,
  Flask,
  Report,
  Download,
  Target,
  Circle,
  RingPartial,
  X,
  Sparkles,
  Brain,
};
