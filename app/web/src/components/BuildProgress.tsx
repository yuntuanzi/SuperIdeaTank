import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuildEvent } from '../types';
import { Icon } from './Icon';

// 生态缸构建进度：把服务端推来的过程事件渲染成「阶段清单 + 模型思考过程」。
//
// 为什么要有这个组件：一次真实构建里，AI 逐条识别约 10s、整缸派系归纳约 40s
// （推理模型的思考本就慢）。干等一个空白页 50 秒对用户是纯损耗；
// 把「现在在做什么、模型在想什么」如实展示出来，等待就变成可理解的过程。
//
// 红线：这里没有任何循环装饰动画。旋转的 loading 圈、脉冲点都被禁止；
// 「还在动」由秒数计时如实表达。思考过程是真实输出的增量，不是假进度条。

// 阶段顺序与 server 端 emit 的 key 对齐；search 通道没有 enrich，自动跳过
const STAGE_ORDER = ['fetch', 'enrich', 'annotate', 'explain', 'done'] as const;

type StageRow = { key: string; label: string; state: 'start' | 'done'; detail?: string };

export function BuildProgress({
  question,
  events,
  onCancel,
}: {
  question: string;
  events: BuildEvent[];
  onCancel?: () => void;
}) {
  // 秒数计时：AI 思考期可能十几秒没有任何事件，用户需要看到「还在推进」
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 同一 key 后到的事件覆盖先到的：annotate 会先发 start（带样本数），再发 done（带结果详情）
  const stages = useMemo<StageRow[]>(() => {
    const byKey = new Map<string, StageRow>();
    for (const e of events) {
      if (e.type === 'stage') byKey.set(e.key, { key: e.key, label: e.label, state: e.state, detail: e.detail });
    }
    return STAGE_ORDER.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
  }, [events]);

  const logs = useMemo(() => events.filter((e): e is Extract<BuildEvent, { type: 'log' }> => e.type === 'log'), [events]);

  // 思考过程按阶段分段累积：逐条识别与派系归纳是两个独立的流，
  // 混成一段会读不出「此刻在想哪一步」。
  const thoughts = useMemo(() => {
    const byStage = new Map<string, string>();
    for (const e of events) {
      if (e.type !== 'reasoning') continue;
      const key = e.stage || 'ai';
      byStage.set(key, (byStage.get(key) || '') + e.text);
    }
    return [...byStage.entries()].map(([stage, text]) => ({ stage, text }));
  }, [events]);

  const thinkingText = thoughts.map((t) => t.text).join('');
  const boxRef = useRef<HTMLDivElement>(null);
  // 只有当用户本来就贴着底部时才自动跟随：用户往回翻看时不能把他拽回去
  const stickRef = useRef(true);
  useEffect(() => {
    const box = boxRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [thinkingText]);

  const done = stages.filter((s) => s.state === 'done').length;

  return (
    <div className="panel-card build-card">
      <div className="build-head">
        <div style={{ minWidth: 0 }}>
          <div className="build-q">{question}</div>
          <div className="build-sub">
            正在构建生态缸 · 已完成 {done}/{stages.length} 个阶段 · 已用 {elapsed} 秒
          </div>
        </div>
        {onCancel && (
          <button className="backlink" onClick={onCancel}>
            <Icon.X size={12} /> 取消
          </button>
        )}
      </div>

      <div className="build-steps">
        {stages.map((s) => (
          <div className={`build-step ${s.state}`} key={s.key}>
            <span className="st-icon">
              {s.state === 'done' ? <Icon.Check size={13} /> : <Icon.RingPartial size={13} />}
            </span>
            <span className="st-label">{s.label}</span>
            {s.detail && <span className="st-detail">{s.detail}</span>}
          </div>
        ))}
      </div>

      {thoughts.length > 0 && (
        <div className="build-think">
          <div className="build-think-head">
            <Icon.Sparkles size={12} />
            <span>模型思考过程（实时输出）</span>
            <span className="st-detail">{thinkingText.length} 字</span>
          </div>
          <div
            className="build-think-body"
            ref={boxRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {thoughts.map((t) => (
              <div key={t.stage}>{t.text}</div>
            ))}
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="build-logs">
          {logs.map((l, i) => (
            <div className="build-log" key={i}>
              {l.text}
            </div>
          ))}
        </div>
      )}

      <p className="tiny-note">
        思考过程来自模型实时输出，可能包含未采用的中间判断；最终标签以右侧「判定依据」为准。
      </p>
    </div>
  );
}
