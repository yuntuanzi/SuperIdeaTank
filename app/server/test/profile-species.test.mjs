// 「我的观点画像」构建器测试：纯函数，直接喂假创作数据，不碰网络与凭证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpeciesProfile } from '../src/speciesProfile.js';
import { STANCES, STRATEGIES } from '../src/annotator.js';

const DATA_HEAVY = {
  title: '如何看待远程办公的效率争议？',
  url: 'https://www.zhihu.com/answer/101',
  excerpt: '数据显示远程办公占比提升了 30%。根据某机构的统计报告，平均每周节省通勤时间 5 小时，换算下来相当于多出一整个工作日。因此我更倾向于认为效率没有下降。',
};
const STORY = {
  title: '你在工作中遇到过哪些离谱的事？',
  url: 'https://www.zhihu.com/answer/102',
  excerpt: '那年我刚到深圳，记得有一次和同事加班到凌晨三点，房租都快交不起了。后来老板在办公室请大家吃烤鱼，我们才慢慢熬过来。',
};
const EMPTYISH = {
  title: '今天天气怎么样？',
  url: 'https://www.zhihu.com/answer/103',
  excerpt: '嗯。',
};

test('画像：逐条标注并统计立场/策略分布，兜底策略不计入分布而计入 unidentified', () => {
  const profile = buildSpeciesProfile([DATA_HEAVY, STORY, EMPTYISH]);
  assert.equal(profile.total, 3);
  // 「嗯。」没有任何策略特征，annotator 会兜底为数据论证；它应进 unidentified 而非 strategyDist
  assert.equal(profile.unidentified, 1);
  const strategySum = Object.values(profile.strategyDist).reduce((a, b) => a + b, 0);
  assert.equal(strategySum + profile.unidentified, profile.total);
  const stanceSum = Object.values(profile.stanceDist).reduce((a, b) => a + b, 0);
  assert.equal(stanceSum, profile.total);
  assert.equal(profile.dominantStrategy, '数据论证');
  // 分布键完整：六个立场 + 六个策略都要在，缺键会让前端直方图渲染出 undefined
  for (const s of STANCES) assert.ok(s in profile.stanceDist);
  for (const s of STRATEGIES) assert.ok(s in profile.strategyDist);
  assert.ok(profile.analyzedAt > 0);
});

test('画像：样本最多 5 条、按置信度降序、每条带判定依据', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    title: `第${i}题：如何看待加班文化？`,
    url: `https://www.zhihu.com/answer/${i}`,
    excerpt: DATA_HEAVY.excerpt,
  }));
  const profile = buildSpeciesProfile(many);
  assert.equal(profile.samples.length, 5);
  for (let i = 1; i < profile.samples.length; i++) {
    assert.ok(profile.samples[i - 1].confidence >= profile.samples[i].confidence);
  }
  for (const sample of profile.samples) {
    assert.ok(sample.title && sample.url);
    assert.ok(Array.isArray(sample.evidence.stance) && Array.isArray(sample.evidence.strategy));
    // 样本不允许携带正文全文：只给标题/链接/判定与依据，减少用户内容滞留内存的窗口
    assert.equal('excerpt' in sample, false);
  }
});

test('画像：无公开创作是正常结果而非错误，total=0 且所有计数为零', () => {
  const profile = buildSpeciesProfile([]);
  assert.equal(profile.total, 0);
  assert.equal(profile.dominantStrategy, null);
  assert.equal(profile.dominantStance, null);
  assert.deepEqual(profile.samples, []);
  assert.equal(profile.unidentified, 0);
  assert.ok(Object.values(profile.strategyDist).every((n) => n === 0));
  assert.ok(Object.values(profile.stanceDist).every((n) => n === 0));
  // 非数组输入（上游接口异常形状）同样按空处理，不抛异常
  assert.equal(buildSpeciesProfile(null).total, 0);
});
