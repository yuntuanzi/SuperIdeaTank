import { useEffect, useRef, useState } from 'react';

interface SplashIntroProps {
  onComplete?: () => void;
}

export function SplashIntro({ onComplete }: SplashIntroProps) {
  // phase:
  // 'hidden' -> 准备中
  // 'center' -> 在正中间优雅浮现、文字带有光泽与浮升效果
  // 'flying' -> 计算绝对坐标，直接从正中间飞渡移动到 Hero H2 的几何位置
  // 'done' -> 动画结束卸载
  const [phase, setPhase] = useState<'hidden' | 'center' | 'flying' | 'done'>('hidden');
  const [flyStyle, setFlyStyle] = useState<React.CSSProperties>({});
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. 下一帧触发 center 渐现
    const raf1 = requestAnimationFrame(() => {
      setPhase('center');
    });

    // 2. 在中间展示 2.0s 让用户清晰赏读这两行文字
    const timer1 = window.setTimeout(() => {
      // 获取 Hero 标题在视口中的精确位置
      const targetEl = document.getElementById('hero-title');
      const cardEl = cardRef.current;

      if (targetEl && cardEl) {
        const targetRect = targetEl.getBoundingClientRect();
        const cardRect = cardEl.getBoundingClientRect();

        // 计算当前卡片中心点到目标中心点的平移差量
        const currentCenterX = cardRect.left + cardRect.width / 2;
        const currentCenterY = cardRect.top + cardRect.height / 2;
        const targetCenterX = targetRect.left + targetRect.width / 2;
        const targetCenterY = targetRect.top + targetRect.height / 2;

        const deltaX = targetCenterX - currentCenterX;
        const deltaY = targetCenterY - currentCenterY;
        const scale = Math.min(1, targetRect.width / cardRect.width);

        setFlyStyle({
          transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scale})`,
          opacity: 0,
          transition: 'transform 1.1s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
        });
      } else {
        // 兜底（未找到元素时默认向上位移）
        setFlyStyle({
          transform: 'translate3d(0, -28vh, 0) scale(0.85)',
          opacity: 0,
          transition: 'transform 1.1s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
        });
      }

      setPhase('flying');
    }, 2100);

    // 3. 飞行完毕后彻底卸载
    const timer2 = window.setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, 3300);

    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(timer1);
      window.clearTimeout(timer2);
    };
  }, [onComplete]);

  if (phase === 'done') return null;

  return (
    <div
      className={`splash-overlay ${phase === 'flying' ? 'is-flying' : ''} ${phase === 'hidden' ? 'is-hidden' : ''}`}
      aria-hidden="true"
    >
      <div
        ref={cardRef}
        className={`splash-card ${phase === 'center' ? 'is-center' : ''}`}
        style={phase === 'flying' ? flyStyle : undefined}
      >
        <div className="splash-badge">
          <span className="splash-dot" />
          OPINION EVOLUTION TANK
        </div>
        <div className="splash-title">
          <div className="splash-line line-1">每一个问题，都是一片观点厮杀的生态缸。</div>
          <div className="splash-line line-2">现在，你可以亲眼看见这场进化。</div>
        </div>
      </div>
    </div>
  );
}
