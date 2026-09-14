// 演示数据：未配置 Access Secret 时的降级数据源。
// 诚信原则：作者使用虚构示例名，前端有「演示数据」醒目标识，绝不冒充真实知乎用户内容。

export const demoHot = {
  source: 'demo',
  fetchedAt: Date.now(),
  items: [
    { title: '为什么年轻人开始反感「无效加班」？', url: 'https://www.zhihu.com/question/demo-1', summary: '从表演式加班到效率革命，职场文化正在发生什么变化。', thumbnail: '' },
    { title: '第一份工作应该选大厂还是小公司？', url: 'https://www.zhihu.com/question/demo-2', summary: '平台光环与成长速度的取舍，过来人怎么看。', thumbnail: '' },
    { title: 'AI 会淘汰程序员，还是重塑程序员？', url: 'https://www.zhihu.com/question/demo-3', summary: '从工具到同事，AI 对软件行业分工的深层影响。', thumbnail: '' },
    { title: '存钱和投资，年轻人应该先做哪个？', url: 'https://www.zhihu.com/question/demo-4', summary: '第一桶金的意义，远不止数字本身。', thumbnail: '' },
    { title: '读研三年和工作三年，差距有多大？', url: 'https://www.zhihu.com/question/demo-5', summary: '学历溢价与经验溢价的时间窗口之争。', thumbnail: '' },
    { title: '一个人开始走上坡路的迹象是什么？', url: 'https://www.zhihu.com/question/demo-6', summary: '真正重要的问题。', thumbnail: '' },
    { title: '如何看待「精致的利己主义者」这个标签？', url: 'https://www.zhihu.com/question/demo-7', summary: '利己、利他与规则边界的再讨论。', thumbnail: '' },
    { title: '为什么建议大学生在校期间做一次完整项目？', url: 'https://www.zhihu.com/question/demo-8', summary: '从课本知识到工程能力的惊险一跃。', thumbnail: '' },
  ],
};

const T = (day, hour) => Math.floor(new Date(2026, 7, day, hour).getTime() / 1000);

export function demoEcosystem(question) {
  const q = question || '为什么年轻人开始反感「无效加班」？';
  const species = [
    { id: 'd1', stance: '反对', strategy: '数据论证', summary: '加班时长与产出不成正比' },
    { id: 'd2', stance: '支持', strategy: '情绪共鸣', summary: '被偷走的夜晚值得被愤怒' },
    { id: 'd3', stance: '中立', strategy: '数据论证', summary: '行业差异显著不可一概而论' },
    { id: 'd4', stance: '解构', strategy: '抖机灵', summary: '反感的不是加班是不表演' },
    { id: 'd5', stance: '支持', strategy: '故事叙事', summary: '我在小厂的真实加班经历' },
    { id: 'd6', stance: '反对', strategy: '引用权威', summary: '劳动法视角下的加班文化' },
    { id: 'd7', stance: '中立', strategy: '身份站队', summary: '管理者与打工人立场有别' },
    { id: 'd8', stance: '补充', strategy: '数据论证', summary: '远程办公是第三条路' },
    { id: 'd9', stance: '反讽', strategy: '抖机灵', summary: '工位灯光越亮KPI越稳' },
    { id: 'd10', stance: '支持', strategy: '情绪共鸣', summary: '这一代人只是想要下班自由' },
  ].map((s, i) => ({
    ...s,
    title: q,
    excerpt: `（演示数据）这是一条用于展示生态缸交互的示例回答摘要，实际使用时将由知乎开放平台搜索接口返回真实内容。立场「${s.stance}」、策略「${s.strategy}」。`,
    author: `示例作者·${String.fromCharCode(65 + i)}`,
    badgeText: '',
    authority: ((i * 3) % 4) + 1,
    votes: [4200, 3100, 2600, 1900, 1500, 980, 760, 540, 320, 180][i],
    comments: [230, 180, 120, 95, 88, 60, 44, 39, 28, 12][i],
    editTime: T(2 + i * 3, 9 + (i % 8)),
    url: `https://www.zhihu.com/question/demo/answer/${i + 1}`,
    featuredComments: ['（演示数据）精选评论示例：说出了心声。', '（演示数据）精选评论示例：数据来源求补充。'],
    annotationSource: 'demo',
    // 演示标签是预设情节，没有来自文本的机器证据，不能伪装成高置信分类。
    confidence: 0,
    evidence: { stance: [{ term: '演示预设标签', weight: 0 }], strategy: [{ term: '演示预设标签', weight: 0 }] },
  }));
  return {
    question: q,
    source: 'demo',
    createdAt: Date.now(),
    species,
    narrative: `「${q}」的演示生态缸中采集到 ${species.length} 个观点物种。配置 Access Secret 后，这里将展示知乎开放平台返回的真实数据与本地启发式标注结果。`,
    // 演示模式也遵守相同空值契约，避免前端把缺失字段误当成已经获取的 AI 内容。
    aiNarrative: null,
    aiNarrativeSource: null,
    aiFactions: null,
    aiDominant: null,
    annotationWarning: null,
  };
}

// 放生实验的演示结果由 index.js 直接调用 ruleModel.survivalRule 组装，不消耗直答额度。
