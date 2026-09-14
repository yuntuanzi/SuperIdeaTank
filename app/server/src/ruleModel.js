// 透明存活概率模型（无 AI 依赖，公式公开可解释）
// P = 100 × (0.35×策略蓝海度 + 0.25×立场差异化 + 0.20×权威压力缓冲 + 0.20×互动基础度)

export function survivalRule(species, { stance, strategy }) {
  const n = species.length || 1;
  const sameStrategy = species.filter((s) => s.strategy === strategy).length;
  const sameStance = species.filter((s) => s.stance === stance).length;
  const maxAuthority = Math.max(1, ...species.map((s) => s.authority || 1));
  const maxComments = Math.max(0, ...species.map((s) => s.comments || 0));

  const blueOcean = 1 - sameStrategy / n;
  const stanceDiversity = 1 - sameStance / n;
  const authorityBuffer = 1 - ((maxAuthority - 1) / 3) * 0.5;
  const interaction = maxComments > 0 ? Math.min(1, 0.4 + 0.6 / Math.log2(maxComments + 2)) : 0.6;

  const probability = Math.round(100 * (0.35 * blueOcean + 0.25 * stanceDiversity + 0.2 * authorityBuffer + 0.2 * interaction));

  const rival = [...species].sort((a, b) => b.votes - a.votes).find((s) => s.stance === stance) || species[0];
  return {
    stance,
    strategy,
    probability: Math.max(2, Math.min(98, probability)),
    suppressedBy: rival
      ? `${rival.stance}立场的高能量回答（${rival.votes ?? '热序'} 赞同${rival.summary ? `，${rival.summary}` : ''}）`
      : '当前生态中的优势物种',
    risks: [
      sameStrategy >= 2
        ? `「${strategy}」策略已有 ${sameStrategy} 个物种使用，同质化竞争激烈`
        : '策略相对稀缺，具备蓝海优势',
      sameStance >= 3
        ? `「${stance}」立场物种密集，需要更强的论据突围`
        : '立场差异化明显，容易被记住',
    ],
    advice: [
      sameStrategy >= 2
        ? '杂交建议：开头加入 30 字以内的真实个人经历，与同策略回答形成记忆点'
        : '保持策略稀缺性，首句直接给出明确结论',
      '第二段补充一个可验证的数据或来源，提高论证权重',
    ],
    narrative: sameStrategy >= 2 ? '策略红海，需要一次变异才能上岸' : '占据稀缺生态位，具备存活基础',
  };
}
