export const STANCES = ['支持', '反对', '中立', '解构', '反讽', '补充'];
export const STRATEGIES = ['数据论证', '情绪共鸣', '故事叙事', '身份站队', '抖机灵', '引用权威', '未识别'];

// 兜底类：任何词典特征都没命中时使用，代表「这条回答的说服方式识别不出来」。
// 它必须显式存在 —— 之前用「数据论证」兼作 pickWinner 的 fallback，导致零证据的
// 短回答被贴上「摆数据」的标签（2026-09-15 实测：清朝人口缸 3/10 条零证据却判数据论证）。
// 把「没识别出来」诚实地报出来，比给一个看起来具体的错误标签更有价值。
const STRATEGY_FALLBACK = '未识别';
// 立场侧保留「中立」兜底：中文回答里确实存在大量不站队的陈述，
// 且「未识别」在立场维度上产品语义更别扭，故此处不改。
const STANCE_FALLBACK = '中立';

const QUESTION_PATTERNS = [
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

// 词典按语言现象分组：同一类词不是同义词表，而是中文知乎回答里常见的表态、转向和修辞信号。
const STANCE_FEATURES = {
  反对: [
    feature('不敢苟同', 3.2, '显式否定对方观点'),
    feature('并非', 1.4, '解释中常用的反向限定'),
    feature('未必', 1.3, '弱否定会降低原命题确定性'),
    feature('恰恰相反', 2.8, '直接反转原命题'),
    feature('我不信', 3.2, '第一人称不采信'),
    feature('不靠谱', 3, '口语化否定判断'),
    feature('站不住脚', 2.8, '论证有效性否定'),
    feature('纯属', 1.8, '贬低式归因'),
    feature('所谓的', 1.8, '对概念合法性降格'),
    feature('翻译一下就是', 2.2, '把漂亮叙事还原成负面含义'),
    feature('说得好听', 2.2, '识别包装话术'),
    feature('有些不同看法', 2.2, '温和反对在知乎长答里很常见'),
    feature('很难让人感动', 2.2, '否定情怀包装的说服力'),
    feature('评论区早炸了', 1.6, '借公众反应表达反对'),
    feature(/不可能|不能|不是|没有意义|无意义/g, 0.9, '高频否定推动反对分'),
    feature(/(?:并不|毫不)(?:无辜|冤枉)/g, 1.8, '「并不无辜/冤枉」是中文常用的部分否定判词'),
    // 2026-09-15 扩充：历史/观点争议类话题的表态信号。
    // 实测「清朝人口」缸 10 条回答全部落入兜底中立，原因是词典只覆盖职场/法条语境，
    // 而争议类回答的反对信号集中在「否定对方论述可信度」而非「否定某个行动」。
    // 下面这组词与话题无关，都是中文里通用的「拆穿叙述」用语，不构成对特定历史叙事的立场。
    feature(/(?:不要|别|不能|不可)(?:再)?信/g, 2.4, '劝阻采信是争议话题里最直接的否定表态'),
    feature(/(?:伪史论|伪史|捏造|编造|杜撰|虚构)/g, 3, '指控对方论述为伪造'),
    feature(/(?:所谓的|所谓)/g, 1.8, '给概念加「所谓」是降格其合法性'),
    feature(/(?:吹捧|吹嘘|包装|美化|洗白|翻案)/g, 2.4, '指控对方在美化事实'),
    feature(/(?:伪到不能再伪|错得离谱|胡说八道|一派胡言|纯属扯淡)/g, 3.2, '强否定的固定表达'),
    feature(/(?:事实上|实际上|真相是|事实是).{0,40}(?:并不|并非|不是|没有)/g, 2.6, '「事实恰恰不是」式反驳'),
    feature(/(?:差不多|不相上下|甚至不如|还不如|还不如说)/g, 1.6, '用比较消解对方的「特殊/突出」叙事'),
    feature(/(?:谁不知道|谁信|谁还)/g, 2.2, '反问式共识诉求，隐含否定'),
  ],
  支持: [
    feature('确实', 1.8, '确认前文判断'),
    feature('的确', 1.8, '确认前文判断'),
    feature('没错', 2.4, '直接同意'),
    feature('说得对', 2.6, '直接同意'),
    feature('同意', 2.4, '直接同意'),
    feature('我赞成', 3, '显式站队'),
    feature('值得肯定', 2.8, '正向评价'),
    feature('已经属于', 2.1, '把行为纳入正面范畴'),
    feature('属实是好事', 3, '明确正向结论'),
    feature('承担社会责任', 2.6, '替被评价对象辩护'),
    feature('更好', 1.8, '比较型支持常通过优劣判断出现'),
    feature('一定是', 1.5, '强断言通常服务于站队'),
    feature('不再认同', 1.4, '在归因题中常用于认同题干里的反感对象'),
    feature('拒绝', 1.1, '归因题里会用拒绝复述题干立场'),
    feature('反感', 1.1, '归因题里会用反感复述题干立场'),
  ],
  解构: [
    feature('这个问题本身', 3, '把讨论对象转移到问题框架'),
    feature('伪命题', 3, '否定题目成立方式'),
    feature('问错了', 3, '直接重设问题'),
    feature('真正的问题是', 3, '显式重构讨论焦点'),
    feature('换个角度', 2.4, '提示框架切换'),
    feature('先别急着', 2.1, '延迟站队以重设前提'),
    feature('我们先定义', 2.6, '先定义说明回答在拆概念'),
    feature('本质原因是什么', 2.8, '把表层事件转为原因分析'),
    feature('本质上是', 2.4, '抽象出底层机制'),
    feature('拆解一下', 2.8, '明确进入拆解姿态'),
    feature('其实是', 2.2, '把表象翻译成另一套机制'),
    feature('原因很简单', 1.4, '归因式改写常从这里进入'),
    feature('哪个好听一点', 2.6, '用措辞比较揭穿框架包装'),
    feature('阳谋', 1.8, '将事件解释成策略安排'),
    feature('先来看', 1.2, '结构化拆解的开场信号'),
  ],
  反讽: [
    feature('懂的都懂', 3.2, '社媒反讽固定表达'),
    feature('多谢款待', 3, '以感谢包装负面评价'),
    feature('狗头', 2.8, '中文互联网反讽标记'),
    feature('学会了', 2.7, '把坏做法说成经验学习'),
    feature('支个招', 2.7, '用建议姿态包裹嘲讽'),
    feature('熟悉的配方', 2.8, '梗式套话通常带嘲讽'),
    feature(/[“"「](格局大|情怀|高效|遥遥领先)[”"」]/g, 2.6, '引号包裹褒义词常表示反话'),
    feature(/[？！?!]{2,}/g, 1.6, '强情绪标点常与反讽共现'),
    feature(/(高效|先进|领先|格局大|情怀).{0,24}(不|没|无|却|只是|直接用外包)/g, 2.2, '褒义词后接否定会形成反语'),
    feature(/了说是/g, 2.6, '句尾「了说是」是阴阳怪气式转述腔，几乎只在反讽语境出现'),
    feature(/都(?:没|没有)这么(?:狠|夸张|离谱|拼|卷)/g, 2.2, '「连……都没这么……」比较级归谬是常见的嘲讽句式'),
    // 2026-09-15 扩充：争议话题里「正话反说」是高频修辞，纯褒义词堆叠配合反问即构成反讽。
    // 实测样本：「上了知乎我才知道清朝这么牛逼」「你的牛逼劲儿呢？」——不含任何现成梗词，
    // 旧词典零命中，但它显然是反讽。这里用「褒义/夸张评价 + 反问或引号」的组合来识别。
    feature(/[“"「][^”"」]{2,16}[”"」].{0,30}(?:不是|没|没有)/g, 2.4, '引号引述褒义说法后紧跟否定，构成反语'),
    feature(/(?:这么|多么|可真|真是)[^。！？\n]{0,12}(?:牛逼|厉害|伟大|光荣|正确|先进|优秀)/g, 2.6, '夸张褒扬是中文反讽最典型的形式'),
    feature(/[，,][^。！？\n]{0,16}(?:对吧|是吧|对吗|不是吗|不是吗)[？?]/g, 2.4, '句尾反问求认同，反讽语境里实为反怼'),
  ],
  补充: [
    feature('补充一点', 3, '显式补充已有答案'),
    feature('另外', 2.3, '追加维度'),
    feature('顺便', 2.2, '顺手扩展讨论'),
    feature('还有一个角度', 3, '显式增加视角'),
    feature('以上答案', 2.6, '站在既有回答之后补足'),
    feature('没人提到', 2.8, '指出遗漏'),
    feature('我再说一个', 2.8, '追加案例'),
    feature('对比一下', 2.4, '用参照系补充说明'),
    feature('应对方式', 1.7, '横向拿其他主体作补充参照'),
    feature('对上', 1.4, '补充组织内外视角时常见'),
    feature('对内', 1.4, '补充组织内外视角时常见'),
  ],
  // 中立的正向特征：真中立（明确不站队/条件化判断）和「什么都没识别出来」的兜底中立
  // 必须区分开 —— 命中这里的中立有真实证据和置信度，兜底中立仍然是低置信度。
  中立: [
    feature('没有标准答案', 2.6, '显式承认问题无定论'),
    feature(/(?:分情况|视情况而定|具体情况具体分析|因人而异|因情况而异)/g, 2.4, '把判断交给条件是典型不站队'),
    feature(/(?:两边|双方|两派)都有(?:道理|可取之处|问题)/g, 2.4, '双向认可说明回答者拒绝选边'),
    feature('取决于', 1.8, '条件化句式常见于中立回答'),
    feature(/(?:没有|并无|不存在)(?:什么)?争议/g, 2.2, '直接声明无争议即不站队'),
  ],
};

// 首句判词：中文回答面对「能否/该不该/会不会」型问题，常先用一到几个字的判词开篇
// 再展开论证（「不能。」「不太能，」「没意义。」「很难平息争议，因为」）。
// 这个判词是整条回答立场最可靠的信号 —— 论证过程里的「不」大多是陈述而非表态，
// 全文词频完全丢弃了位置信息。所以这类特征只在开头一小段内匹配，
// 权重设为普通特征的 2–3 倍（位置带来的可靠性，不是词本身更重要）。
const OPENING_VERDICT_FEATURES = {
  反对: [
    feature(/^(?:不太?(?:能|会|行)|不能|不会|不行|不可以|不至于|没(?:有)?(?:意义|用|必要)|不可能|难说)/, 3, '开头直接否定判词'),
    feature(/^(?:很难|难以|恐怕不|基本不|未必|难言)/, 2.6, '开头程度化否定判词'),
    feature(/^.{0,6}(?:翻车|塌房|洗白|卖惨|双标|装无辜)/, 2.6, '开篇直接给事件或当事人负面定性'),
  ],
  支持: [
    feature(/^(?:能|会|可以|当然|肯定|值得|确实如此)(?=[，。,、！？!?])/, 2.8, '开头直接肯定判词'),
  ],
  解构: [
    feature(/^(?:先说结论|结论先行|这个问题问反了|问题本身就有问题)|抛开.{0,4}事实不谈/, 1.6, '元评论开篇说明回答要重设问题框架'),
  ],
  中立: [
    feature(/(?:没有|无)(?:什么)?争议/, 2.8, '开篇自陈无争议是明确的不站队表态'),
  ],
};

// 策略词典分组围绕“回答靠什么说服人”，权威、数据、叙事、情绪、身份和机锋应彼此竞争。
const STRATEGY_FEATURES = {
  数据论证: [
    // 裸数字/裸量级词不计分（spec 2.2 方案 B）：历史、财经类长文天然数字密集，
    // 把数字密度当绝对阈值会让整缸 10/10 全判数据论证。
    // 数字必须与论证性连接词同句出现才计分，见 addDerivedSignals 里的 gated 信号。
    feature(/[一二三四五六七八九十\d]+[、.．]/g, 1.5, '编号列点说明回答在结构化归因'),
    feature(/月薪\s*\d+/g, 2.2, '薪资数字通常服务于算账'),
    feature('数据显示', 2.8, '直接引用数据'),
    feature('统计', 2.4, '数据来源或统计口吻'),
    feature('占比', 2.2, '比例论证'),
    feature('平均', 1.8, '统计描述'),
    feature(/根据.{0,12}报告/g, 2.6, '来源化的数据论证'),
    feature('离职率', 2.2, '企业话题里的量化指标'),
    feature('算一笔', 2, '中文长答里的算账提示词'),
    feature('换算', 1.8, '比较成本时常用'),
    feature('计划', 1.1, '事实计划会把回答推向证据说明'),
    // 2026-09-15 扩充：**推理性论证**（靠事实/逻辑推进，而非叙事或情绪）也属于「数据论证」。
    // 实测 v2 锚点 [0][2][3][6] 被人工标为数据论证，但它们的原文里一个数字都没有 ——
    // 标注依据是「重设焦点 / 归因 / 类比」这套论证动作（如「不在于…而是在于…」
    // 「现在矛盾根本不是…而是…」）。这类连接词与话题无关，是中文议论的通用骨架。
    feature(/(?:不在于|不是|并非)[^。！？\n]{0,40}(?:而是在于|而是在|而是)/g, 2.6, '「不在于A而在于B」是典型的重设焦点论证'),
    feature(/(?:根本|关键|重点|核心|真正)[^。！？\n]{0,10}(?:不是|不在)/g, 2.4, '显式指出真正的争点所在'),
    feature(/(?:首先|其次|再次|第一|第二|第三)[，,、]/g, 2, '分点论证是结构化说理的外显标记'),
    feature(/(?:因为|所以|因此|说明|意味着|由此可见|也就是说)/g, 1.5, '因果与推论连接词密集说明在说理'),
    feature(/[^。！？\n]{6,}(?:的前提|的前提下|的逻辑|的根源|的本质)/g, 2, '抽象出前提/逻辑/根源属于论证行为'),
  ],
  引用权威: [
    feature(/《[^》]{2,40}》/g, 3.6, '书名号常指法律、书籍或正式文件'),
    feature(/第\s*\d+\s*条/g, 3.2, '法条编号比普通数字更能说明引用权威'),
    feature('法律规定', 3, '显式诉诸制度文本'),
    feature('劳动合同法', 3.4, '本题语料里最关键的法律依据'),
    feature('劳动法', 2.8, '劳动权益语境里的权威来源'),
    feature('专家', 2.1, '诉诸专业身份'),
    feature('教授', 2.1, '诉诸专业身份'),
    feature('论文', 2.3, '学术来源'),
    feature('官方', 2.1, '制度或机构来源'),
    feature('白皮书', 2.6, '正式文件来源'),
    feature(/\[\d+\]/g, 2.8, '脚注标记比正文数字更像引用'),
    feature('法律法规', 1.8, '概括性制度依据'),
    feature('法条', 2.6, '明确进入法律文本'),
  ],
  故事叙事: [
    feature(/我.{0,24}(那年|当年|后来|记得|有一次|\d{4}年)/g, 3.2, '第一人称过去时是叙事骨架'),
    feature(/\d{4}年[，,]?\s*我/g, 3.4, '具体年份加第一人称强烈指向故事'),
    feature('那年', 2.2, '回忆叙事时间词'),
    feature('当年', 2.2, '回忆叙事时间词'),
    feature('后来', 1.9, '时间推进'),
    feature('记得', 2.1, '回忆开场'),
    feature('有一次', 2.5, '个案叙事开场'),
    feature(/老[陈王李张刘]|室友|同事|朋友/g, 1.8, '具体人物关系让回答进入故事'),
    feature(/先.{0,40}然后.{0,80}后来/g, 3, '时间推进链'),
    feature(/烤鱼|深圳|实验室|饭桌|房租/g, 1.1, '具体场景细节增强叙事可信度'),
  ],
  情绪共鸣: [
    feature('累', 1.4, '身体感受会把回答推向共鸣'),
    feature('熬', 1.7, '加班语境里的痛感词'),
    feature('心疼', 2.3, '情感认同'),
    feature('委屈', 2.3, '情感认同'),
    feature('愤怒', 2.1, '强情绪表达'),
    feature('无奈', 1.9, '情绪表达'),
    feature('扛不住', 2.3, '身体化压力描述'),
    feature('真心觉得', 2.6, '主观感受显式化'),
    feature('说出了心声', 2.8, '共鸣固定表达'),
    feature('极其反感', 2.4, '强情绪立场'),
    feature('拖垮', 1.8, '伤害感表达'),
    feature('毁掉', 1.8, '后果情绪化'),
    feature('没有价值', 1.3, '价值否定配合情绪动员'),
    feature('我们都', 1.8, '共同体共鸣'),
    feature(/！/g, 0.7, '感叹号增加情绪密度'),
  ],
  身份站队: [
    feature(/作为一个.{1,8}/g, 2.6, '显式身份声明'),
    feature(/我们.{1,4}人/g, 2.2, '群体身份自称'),
    feature('打工人', 2.4, '中文职场身份标签'),
    feature('985', 3, '学历身份边界'),
    feature('211', 3, '学历身份边界'),
    feature('文科生', 2.5, '专业身份标签'),
    feature('过来人', 2.3, '经验身份标签'),
    feature('在单位待久了', 2.4, '组织内部身份视角'),
    feature('同行', 2.2, '行业共同体'),
    feature(/老一辈.{0,40}年轻人|年轻人.{0,40}老一辈/g, 2.7, '代际对立构成站队'),
    feature(/甲方.{0,30}乙方|乙方.{0,30}甲方/g, 2.7, '交易身份对立构成站队'),
    feature(/你能进(腾讯|阿里|美团)吗/g, 2.8, '用平台门槛划定学历群体位置'),
  ],
  抖机灵: [
    feature('熟悉的配方，熟悉的味道', 3.6, '梗式表达优先视作抖机灵'),
    feature('支个招', 2.8, '建议姿态包裹玩笑或嘲讽'),
    feature('阳谋', 2.2, '把复杂事压成梗式解释'),
    feature('降降温', 1.8, '轻巧口语收尾'),
    feature('就这么简单', 1.9, '短促断言形成机锋'),
    feature('遥遥领先', 2.4, '社媒梗词'),
    feature(/(?:笑死|笑不活了?|绷不住了)/g, 2.4, '口语笑场标记说明语境在玩梗而非严肃论证'),
    feature('了说是', 2.2, '阴阳怪气式转述句尾，常见于甩梗回答'),
    feature(/[（(][^）)]{2,24}[）)]/g, 1.4, '括号吐槽强化机锋感'),
    // 2026-09-15 扩充：阴阳怪气的**转述腔**与**比较级归谬**同属「靠机锋说服」，
    // 不只是立场信号。实测 v2 锚点 [7]「富士康都没这么狠…超人了说是」命中这两条，
    // 但旧词典只把它们放在 stance 侧，导致策略侧只能拿到一个「数据论证」的门控从句而误判。
    feature(/了说是/g, 2.2, '句尾「了说是」是甩梗体裁的标记'),
    feature(/都(?:没|没有)这么(?:狠|夸张|离谱|拼|卷)/g, 2.2, '比较级归谬是抖机灵的常见句式'),
    feature(/(?:什么样的程度|匮乏到了何等|何等)/g, 1.8, '夸张设问把常识说成笑话，属机锋而非论证'),
    feature(/(?:超人了|赛博|人体电池|雅利安)/g, 2, '戏谑类比用荒诞对象替代事实说明'),
  ],
};

export function classifyQuestion(title) {
  const text = String(title || '');
  for (const group of QUESTION_PATTERNS) {
    const matched = group.patterns.filter((pattern) => patternMatches(pattern, text)).map(patternLabel);
    if (matched.length) return { type: group.type, matched };
  }
  return { type: 'open', matched: [] };
}

export function annotateOne(question, item, ctx = {}) {
  const questionType = normalizeQuestionType(ctx.questionType || classifyQuestion(question));
  const stanceText = String(item?.excerpt || '');
  const strategyText = [item?.excerpt, item?.badgeText].filter(Boolean).join('\n');
  const stanceScores = scoreFeatures(stanceText, STANCE_FEATURES);
  const strategyScores = scoreFeatures(strategyText, STRATEGY_FEATURES);

  addDerivedSignals(stanceText, strategyText, stanceScores, strategyScores);
  applyQuestionPrior(questionType, stanceScores);
  // 反讽必须依赖组合语境；单个梗词容易只是普通口语，两个以上信号才允许它参与竞争。
  if ((stanceScores.hits.反讽 || []).length < 2) stanceScores.scores.反讽 = 0;
  // 首句判词在先验衰减之后单独计入：why/howto 的 0.55 衰减针对的是全文密度类特征，
  // 开头判词是位置信号，「为什么…」型问题下的回答同样可能以判词开篇，不该被衰减到失效。
  scoreOpeningVerdicts(stanceText, stanceScores);
  applyMutualExclusion(strategyScores);

  const stancePick = pickWinner(stanceScores.scores, STANCE_FALLBACK, 1.15, stanceScores.hits);
  // 策略侧兜底类改为「未识别」：零证据时不再冒充「数据论证」。
  // 阈值 0.35 保留 —— 低于它的弱命中说明证据不足以归类，归入「未识别」更诚实。
  const strategyPick = pickWinner(strategyScores.scores, STRATEGY_FALLBACK, 0.35, strategyScores.hits);
  let stance = stancePick.label;
  const strategy = strategyPick.label;

  const stanceConf = confidenceFor(stancePick, stanceScores.hits[stance] || []);
  const strategyConf = confidenceFor(strategyPick, strategyScores.hits[strategy] || []);
  // 立场是否可信只看立场侧的证据强度：策略没识别出来（比如一句话短回答没有任何策略特征，
  // strategy 落入兜底类、置信度为 0）不该把明确的立场表态一起抹成中立 ——
  // 立场与策略是两个独立维度，之前的 min 耦合正是「立场退化」告警的另一半机制。
  const stanceLowEvidence = stanceConf < 0.15;
  // 但 why/howto 型问题保持旧的保守耦合：归因/方法类回答里的否定词大多在陈述而非表态，
  // 立场信号本来就弱；当策略侧也完全零证据（落入兜底类）时，整条回答没有任何
  // 可锚定的表层信号，此时的立场表态不可信，退回中立。
  const adversarialType = questionType.type === 'why' || questionType.type === 'howto';
  const stanceUnanchored = adversarialType && strategyPick.topScore === 0;

  // stance/confidence/evidence 三者必须一致。之前只改写 stance，导致出现
  // 「stance=中立 但 confidence=0.6、evidence=特征不足」这种自相矛盾的返回
  // （2026-09-15 实测：清朝人口缸 [0] conf=0.333、[8] conf=0.601 却都显示特征不足）。
  const stanceOverridden = stanceLowEvidence || stanceUnanchored;
  // 策略侧零证据（纯兜底、topScore 为 0）时 confidence 只取立场侧：
  // 「没有策略意见」不等于「立场也不可信」。否则真中立和所有带明确判词的回答
  // 都会被拖到 0，spec 2.3 要求的正向中立置信度形同虚设。
  const confidence = stanceOverridden
    ? 0
    : round3(strategyPick.topScore === 0 ? stanceConf : Math.min(stanceConf, strategyConf));
  if (stanceOverridden) stance = STANCE_FALLBACK;

  return {
    stance,
    strategy,
    confidence,
    evidence: {
      stance: stanceOverridden ? [{ term: '特征不足', weight: 0 }] : topEvidence(stanceScores.hits[stance] || []),
      strategy: topEvidence(strategyScores.hits[strategy] || []),
    },
  };
}

export function annotateAll(question, items) {
  const questionType = classifyQuestion(question);
  const annotated = (items || []).map((item) => ({
    ...item,
    ...annotateOne(question, item, { questionType }),
    annotationSource: 'local-heuristic',
  }));

  return {
    items: annotated,
    annotationWarning: distributionWarning(annotated),
  };
}

function feature(pattern, weight, note) {
  return { pattern, weight, note };
}

function normalizeQuestionType(questionType) {
  // 调用方可能为了省一次 classifyQuestion 只传字符串；归一化能避免同一先验在集成层失效。
  if (typeof questionType === 'string') return { type: questionType, matched: [] };
  return questionType && typeof questionType === 'object' ? questionType : { type: 'open', matched: [] };
}

function applyQuestionPrior(questionType, stanceScores) {
  // 先验必须在派生特征之后统一施加；否定密度也是 stance 证据，不能绕过 why/howto 衰减。
  if (questionType.type !== 'why' && questionType.type !== 'howto') return;
  scaleLabel(stanceScores, '支持', 0.55);
  scaleLabel(stanceScores, '反对', 0.55);
}

function scaleLabel(scored, label, ratio) {
  // evidence 给前端看的是最终依据，所以权重需要跟随先验衰减，而不是保留原始词典分。
  scored.scores[label] = round3(scored.scores[label] * ratio);
  scored.hits[label] = (scored.hits[label] || []).map((hit) => ({ ...hit, weight: round3(hit.weight * ratio) }));
}

function patternMatches(pattern, text) {
  if (typeof pattern === 'string') return text.includes(pattern);
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function patternLabel(pattern) {
  return typeof pattern === 'string' ? pattern : pattern.source;
}

function scoreFeatures(text, dictionary) {
  const scores = Object.fromEntries(Object.keys(dictionary).map((label) => [label, 0]));
  const hits = Object.fromEntries(Object.keys(dictionary).map((label) => [label, []]));

  for (const [label, features] of Object.entries(dictionary)) {
    for (const { pattern, weight, note } of features) {
      const matches = findMatches(pattern, text);
      if (!matches.length) continue;
      const capped = matches.slice(0, 4);
      const contribution = round3(weight * capped.length);
      scores[label] += contribution;
      hits[label].push({ term: capped.join(' / '), weight: contribution, note });
    }
  }

  return { scores, hits };
}

function findMatches(pattern, text) {
  // 正则 source 对用户没有解释价值；保留真实命中文本才能支撑“可解释标注”的产品承诺。
  if (!text) return [];
  if (typeof pattern === 'string') {
    const matches = [];
    let index = text.indexOf(pattern);
    while (index !== -1) {
      matches.push(pattern);
      index = text.indexOf(pattern, index + pattern.length);
    }
    return matches;
  }

  const source = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  source.lastIndex = 0;
  return [...text.matchAll(source)].map((match) => match[0]);
}

// 开头一小段 = 前 30 个字符或第一个句末标点之前，以先到者为准。
// 判词只有落在这一段里才是「开篇表态」；散落在论证中段同样的词只是叙述。
function openingSegment(text) {
  const head = [...String(text || '')].slice(0, 30).join('');
  const sentence = head.match(/^[^。！？!?\n]*[。！？!?]/);
  return sentence ? sentence[0] : head;
}

function scoreOpeningVerdicts(stanceText, stanceScores) {
  const opening = openingSegment(stanceText);
  if (!opening) return;
  for (const [label, features] of Object.entries(OPENING_VERDICT_FEATURES)) {
    for (const { pattern, weight, note } of features) {
      const matches = findMatches(pattern, opening);
      if (!matches.length) continue;
      const contribution = round3(weight * matches.length);
      stanceScores.scores[label] = round3(stanceScores.scores[label] + contribution);
      stanceScores.hits[label].push({ term: matches.join(' / '), weight: contribution, note });
    }
  }
  // 开篇即反问句（「难道…？」「…到了什么样的程度？」）通常隐含对题干或常识立场的否定，
  // 是较弱信号所以权重低于直接判词；只认带挑战语气的疑问词，纯咨询式问句不算。
  const firstSentence = stanceText.match(/^[^。！？!?\n]*[？?]/);
  if (firstSentence && /难道|凭什么|怎么会|什么样|有什么用|有何意义|何苦|你觉得呢/.test(firstSentence[0])) {
    addHit(stanceScores, '反对', firstSentence[0].trim(), 1.5);
  }
}

function addDerivedSignals(stanceText, strategyText, stanceScores, strategyScores) {
  const lengthBase = Math.max(1, [...stanceText].length / 100);
  const negationDensity = (stanceText.match(/[不没别无]/g) || []).length / lengthBase;
  if (negationDensity > 3) addHit(stanceScores, '反对', '否定副词密度>3/百字', 1.4);

  const sentences = strategyText.split(/[。！？!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const avgSentenceLength = sentences.length ? sentences.reduce((sum, s) => sum + [...s].length, 0) / sentences.length : 999;
  if (avgSentenceLength < 18 && /但|却|不过|那就|这样|直接/.test(strategyText)) {
    addHit(strategyScores, '抖机灵', '短句+转折收尾', 2.2);
  }

  if (/我|我们/.test(strategyText) && /(那年|当年|后来|记得|有一次|\d{4}年)/.test(strategyText)) {
    addHit(strategyScores, '故事叙事', '第一人称+过去时间', 2.8);
  }

  if (
    /我|我们/.test(strategyText) &&
    /(老[陈王李张刘]|室友|同事|朋友|同学|老师|老板)/.test(strategyText) &&
    /(北京|上海|广州|深圳|成都|杭州|武汉|西安|南京|元|块|月薪|工资)/.test(strategyText)
  ) {
    addHit(strategyScores, '故事叙事', '第一人称+人物地点金额同现', 2.6);
  }

  if (/建议.{0,16}(直接|全部|都|一律|干脆|外包|辞退|开除|躺平)/.test(strategyText)) {
    addHit(strategyScores, '抖机灵', '荒诞建议', 2.4);
  }

  if (/(心薪|薪心|班味|卷王|摸鱼)/.test(strategyText)) {
    addHit(strategyScores, '抖机灵', strategyText.match(/心薪|薪心|班味|卷王|摸鱼/)?.[0] || '谐音/双关', 2.2);
  }

  // 数据论证门槛（spec 2.2 方案 B）：数字必须与论证性连接词同句出现才计分。
  // 历史/财经类长文天然数字密集，裸数字密度会让「清朝人口」这种缸 10/10 全判数据论证；
  // 「数字 + 比较/统计/换算类连接词」才把数字锚定到论证行为上，单纯报年份、报数量不算。
  const CONNECTIVE = /因此|占比|相比|比较|增长|下降|减少|锐减|激增|提升|超过|达到|约为|大约|将近|接近|相当于|平均|统计|换算|低于|高于|足足|仅有|只有|翻倍|率/;
  const clauses = strategyText.split(/[。！？!?\n；;]+/).map((s) => s.trim()).filter(Boolean);
  const gated = [];
  for (const clause of clauses) {
    if (gated.length >= 2) break;
    if (/\d/.test(clause) && CONNECTIVE.test(clause)) gated.push(clause.slice(0, 18));
  }
  if (gated.length) {
    addHit(strategyScores, '数据论证', gated.join(' / '), round3(2.4 * gated.length));
  }

  // 多轮「XX：」对话体是实录转写，属于叙事而非数据罗列 ——
  // 对话里出现的数字（营业时间、时长）是引语内容，不构成数据论证。
  const speakerTurns = strategyText.match(/[一-龥A-Za-z]{1,6}[:：]/g) || [];
  if (speakerTurns.length >= 3) {
    addHit(strategyScores, '故事叙事', speakerTurns.slice(0, 4).join(' / '), 3);
  }

  // 判词式超短回答（开头直接给结论、全文一两句话收尾）是知乎典型的甩观点机锋体裁，
  // 没有数据也没有叙事，归入抖机灵比落入兜底类更贴近真实说服方式。
  const opening = openingSegment(stanceText);
  const opensWithVerdict = /^(?:不太?(?:能|会|行)|不能|不会|不行|不可以|不至于|没(?:有)?(?:意义|用|必要)|不可能|难说|很难|难以)/.test(opening);
  if (opensWithVerdict && [...strategyText].length <= 80) {
    addHit(strategyScores, '抖机灵', opening, 2.4);
  }
}

function applyMutualExclusion(strategyScores) {
  // 法条、书名号和脚注是来源结构，不只是普通数字；共现时提高权威侧避免被数字密度吞掉。
  if (strategyScores.scores.引用权威 > 0 && strategyScores.scores.数据论证 > 0) {
    const hasHardAuthority = (strategyScores.hits.引用权威 || []).some((hit) =>
      /《|第\s*\d+\s*条|劳动合同法|劳动法|\[\d+\]|法律|法条/.test(hit.term),
    );
    if (hasHardAuthority) ensurePriority(strategyScores, '引用权威', '数据论证', '权威来源优先');
  }

  // 亲历时间线比情绪词更能解释说服方式；强叙事存在时不让痛感词抢走类别。
  if (strategyScores.scores.故事叙事 >= 4 && strategyScores.scores.情绪共鸣 > 0) {
    ensurePriority(strategyScores, '故事叙事', '情绪共鸣', '亲历叙事优先');
  }

  if (strategyScores.scores.身份站队 >= 5 && strategyScores.scores.数据论证 > 0) {
    strategyScores.scores.身份站队 += 1.2;
  }
}

function addHit(scored, label, term, weight) {
  scored.scores[label] += weight;
  scored.hits[label].push({ term, weight, note: '组合特征比单个词更能说明语用功能' });
}

function ensurePriority(scored, winner, loser, reason) {
  // 互斥规则是硬约束；只加固定小分无法覆盖数字极多或情绪极多的对抗文本。
  const gap = scored.scores[loser] - scored.scores[winner] + 0.001;
  const bonus = round3(Math.max(0, gap));
  scored.scores[winner] = round3(Math.max(scored.scores[winner], scored.scores[loser] + 0.001));
  boostTopHit(scored, winner, bonus, reason);
}

function boostTopHit(scored, label, bonus, reason) {
  // 把优先修正落到最强真实证据上，避免 evidence 展示一个看不见的“隐形加分”。
  if (!bonus) return;
  const hits = scored.hits[label] || [];
  if (!hits.length) return;
  hits.sort((a, b) => b.weight - a.weight);
  hits[0] = { ...hits[0], weight: round3(hits[0].weight + bonus), note: `${hits[0].note}；${reason}` };
}

function pickWinner(scores, fallback, threshold, hits) {
  // 阈值让弱命中回到默认类，避免一个孤立低权重词决定整条回答的物种类型。
  //
  // 平局处理（2026-09-15 新增）：原先直接按 Object.entries 的插入顺序取冠军，
  // 而「数据论证」在 STRATEGY_FEATURES 里排第一，于是**任何平局都静默判给数据论证**。
  // 实测 v2 锚点 [9]（数据论证 2.4 = 抖机灵 2.4）与 [7]（2.4 vs 2.2）就是这样被误判的，
  // 而人工作答期望都是「抖机灵」。
  //
  // 平局时改看**独立证据条数**：命中 2 个不同特征的「抖机灵」比命中 1 个门控从句的
  // 「数据论证」更可信 —— 组合信号比单点信号更难碰巧成立。仅在分数几乎相等
  // （差距 < 0.25）时启用，避免让证据条数推翻明确的分差。
  const entries = Object.entries(scores);
  const sorted = entries.sort((a, b) => {
    if (Math.abs(b[1] - a[1]) >= 0.25) return b[1] - a[1];
    const hitCount = (label) => (hits?.[label] || []).length;
    const byHits = hitCount(b[0]) - hitCount(a[0]);
    if (byHits !== 0) return byHits;
    return b[1] - a[1];
  });
  const [topLabel, topScore] = sorted[0] || [fallback, 0];
  const [, secondScore] = sorted[1] || [fallback, 0];
  if (topScore < threshold) return { label: fallback, topScore: 0, secondScore: topScore };
  return { label: topLabel, topScore, secondScore };
}

function confidenceFor(pick, hits) {
  // 置信度看“领先幅度”和“证据数量”，单一词命中即使分高也不该显得特别确定。
  if (!pick.topScore || !hits.length) return 0;
  const margin = Math.max(0, (pick.topScore - pick.secondScore) / (pick.topScore + 1e-6));
  const hitFactor = Math.min(1, hits.length / 3);
  return margin * hitFactor;
}

function topEvidence(hits) {
  // 同一段文本可能被多个特征命中（如《劳动合同法》与“劳动合同法”）；
  // 合并到最长命中文本并累加权重，前端看到的才是“这一段文字总共贡献了多少证据”，
  // 而不是两条看似独立、实则重叠的证据。
  const merged = [];
  for (const hit of [...hits].sort((a, b) => b.term.length - a.term.length || b.weight - a.weight)) {
    const host = merged.find((kept) => kept.term.includes(hit.term));
    if (host) host.weight = round3(host.weight + hit.weight);
    else merged.push({ ...hit });
  }
  // 只返回前五条让 UI 可读；完整调试可从词典和测试复现，不把页面塞成规则转储。
  return merged
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(({ term, weight }) => ({ term, weight: round3(weight) }));
}

// 分布健康检查对 AI 标注同样适用：AI 也会把一整批回答判成同一类。
// 导出给 AI 标注路径共用，避免两条路径出现两套告警口径。
export function distributionWarning(items) {
  // 分布坍缩比单条误判更伤产品观感；这里让“全部同色”的系统性失败显性化。
  if (!items.length) return null;
  // 策略侧先看「未识别」占比：兜底类过半说明整体说服方式都没识别出来，
  // 这比某一具体类占多数更值得告警，且「未识别」本身不是一种说服方式。
  const unrecognized = items.filter((item) => item.strategy === STRATEGY_FALLBACK).length;
  if (unrecognized / items.length >= 0.5) return '多数回答的说服方式未能识别，策略标注仅供参考';
  return null;
}


function round3(value) {
  // 固定三位小数避免测试和前端展示受浮点尾差影响。
  return Math.round(value * 1000) / 1000;
}
