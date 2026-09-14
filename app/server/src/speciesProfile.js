// 「我的观点画像」构建器：把用户自己的创作逐条识别成观点物种。
//
// 识别引擎优先使用 DeepSeek（与生态缸同一套提示词契约，见 prompts.js PROFILE_SYSTEM），
// 未配置密钥或 AI 失败时回退本地可解释标注器（annotator.js）——两条路径的立场／策略
// 模型完全同源，不新增第二套智能层，也不存在「画像用的是另一套标准」的问题。

import { annotateOne, STANCES, STRATEGIES } from './annotator.js';

// 与前端 Tank.tsx 的 isStrategyUnidentified 同一条判定线：
// 策略为「未识别」，或本地标注器的证据为空／首条是占位词「特征不足」。
function isUnidentified(item) {
  if (item.strategy === '未识别') return true;
  const ev = item?.evidence?.strategy || [];
  return ev.length === 0 || ev[0].term === '特征不足';
}

// aiResult：aiProfileContents() 的返回值，可为 null（未接入 AI 或识别失败）。
export function buildSpeciesProfile(contents, aiResult = null) {
  const list = Array.isArray(contents) ? contents : [];
  const items = list.map((item, idx) => {
    const ai = aiResult?.labels?.[idx];
    // 逐条回退：AI 只对部分条目给出有效标签时，其余条目仍用本地模型，
    // 每条都带上自己的来源标识，界面才能如实说明「这条是谁判的」。
    if (ai?.stance && ai?.strategy) {
      return {
        title: item.title,
        url: item.url,
        stance: ai.stance,
        strategy: ai.strategy,
        confidence: ai.confidence,
        annotationSource: aiResult.source,
        evidence: {
          stance: [{ term: '模型语义判定', weight: 1 }],
          strategy: [{ term: '模型语义判定', weight: 1 }],
        },
      };
    }
    return {
      title: item.title,
      url: item.url,
      ...annotateOne(item.title || '', { excerpt: item.excerpt || '' }),
      annotationSource: 'local-heuristic',
    };
  });

  // 分布先按全量标签初始化为 0，前端直方图不需要猜缺省键
  const stanceDist = Object.fromEntries(STANCES.map((s) => [s, 0]));
  const strategyDist = Object.fromEntries(STRATEGIES.map((s) => [s, 0]));

  let unidentified = 0;
  for (const item of items) {
    stanceDist[item.stance] = (stanceDist[item.stance] || 0) + 1;
    if (isUnidentified(item)) {
      // 兜底标签不算真判定：不计入策略分布，否则某个具体策略会被虚假放大
      unidentified += 1;
    } else {
      strategyDist[item.strategy] = (strategyDist[item.strategy] || 0) + 1;
    }
  }

  // 平票时按词典声明顺序取先出现的，结果稳定可复现（不依赖对象键序之类的隐性行为）
  const dominantOf = (dist, order) => {
    let best = null;
    for (const label of order) {
      if (dist[label] > 0 && (best === null || dist[label] > dist[best])) best = label;
    }
    return best;
  };

  // AI 给出的整体判断优先（它能看到全部内容做整体归纳），但必须过白名单：
  // 一个不在枚举里的主导标签会让前端配色直接取到 undefined。
  const aiDominantStrategy = STRATEGIES.includes(aiResult?.dominantStrategy) ? aiResult.dominantStrategy : null;
  const aiDominantStance = STANCES.includes(aiResult?.dominantStance) ? aiResult.dominantStance : null;

  return {
    total: items.length,
    dominantStrategy: aiDominantStrategy ?? dominantOf(strategyDist, STRATEGIES),
    dominantStance: aiDominantStance ?? dominantOf(stanceDist, STANCES),
    strategyDist,
    stanceDist,
    // 样本按置信度取前 5：评委/用户最想看的是「判得最肯定」的几条及其依据
    samples: [...items]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map(({ title, url, stance, strategy, confidence, evidence }) => ({ title, url, stance, strategy, confidence, evidence })),
    unidentified,
    aiIdentified: aiResult?.identified ?? 0,
    aiSource: aiResult?.source ?? null,
    conclusion: aiResult?.conclusion ?? null,
    analyzedAt: Date.now(),
  };
}
