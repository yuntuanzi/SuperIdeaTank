// 问题类型判定 —— 这是服务端 app/server/src/annotator.js 里 QUESTION_PATTERNS /
// classifyQuestion 的【前端副本】，规则必须保持一致，任何一边改动两边同步。
// 为什么前端要自己判：服务端的 classifyQuestion 结果目前没有透出到 API 响应里，
// 而本轮「色轴自适应问题类型」（附录 A1）与「annotationWarning 分情况措辞」（附录 A3）
// 都依赖问题类型，在不能改服务端的前提下只能在前端复刻同一套句式规则。
export type QuestionType = 'judgement' | 'why' | 'howto' | 'open';

// 与服务端 QUESTION_PATTERNS 一一对应（顺序也是语义的一部分：先判判断型，再归因，再求解）。
const QUESTION_PATTERNS: { type: QuestionType; patterns: (string | RegExp)[] }[] = [
  {
    type: 'judgement',
    patterns: ['如何看待', '怎么看', '是不是', '该不该', '值不值', '算不算', '对不对', /吗[？?]?$/],
  },
  {
    type: 'why',
    patterns: ['为什么', '为何', '原因', '是何原因'],
  },
  {
    type: 'howto',
    patterns: [/如何.+/, '怎么办', '怎样', '有哪些', '推荐'],
  },
];

export function classifyQuestion(title: string): QuestionType {
  const text = String(title || '');
  for (const group of QUESTION_PATTERNS) {
    const hit = group.patterns.some((p) => (typeof p === 'string' ? text.includes(p) : p.test(text)));
    if (hit) return group.type;
  }
  return 'open';
}

// 归因/求解型问题的回答以解释为主而非站队，立场维度对它们不成立（附录 A1）：
// 这两类问题的节点颜色改用「生存策略」编码。
export function isExplanationType(t: QuestionType): boolean {
  return t === 'why' || t === 'howto';
}
