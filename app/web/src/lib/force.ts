import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { SimulationLinkDatum } from 'd3-force';
import type { Species, Stance } from '../types';
import { STANCE_COLORS } from '../types';

export interface VizNode extends Species {
  x: number;
  y: number;
  r: number;
  energy: number;
}

export type VizLink = SimulationLinkDatum<VizNode> & { kind: 'camp' | 'rival' };

// 能量计算：环境干预参数实时重算（纯前端，零 API 消耗）
export function computeEnergy(
  s: Species,
  all: Species[],
  params: { rankMode: 'votes' | 'recent'; climate: 'rational' | 'emotional'; authorityBoost: boolean },
): number {
  const maxVotes = Math.max(1, ...all.map((x) => x.votes ?? 0));
  const maxHeat = Math.max(1, ...all.map((x) => x.heatRank ?? 0));
  const times = all.map((x) => x.editTime).filter((t) => t > 0).sort((a, b) => a - b);
  const recencyRank = times.length > 1 ? 1 - times.indexOf(s.editTime) / (times.length - 1) : 0.5;

  // 两种来源量纲不同，必须各自归一化到 0..1 再进同一个能量公式：
  // 原实现把赞同数原值（可达数百）和热序归一值（0~1）混在一起，
  // maxEnergy 被赞同数顶到几百，未富化节点 √(1/880)≈0.034，半径全贴下限。
  // 有赞同数的节点之间仍是线性缩放，相对大小关系不变（真实数据保真）。
  const votesPart = s.votes != null ? s.votes / maxVotes : (s.heatRank ?? 0) / maxHeat; // 无赞同数时按热序近似
  let energy = params.rankMode === 'votes' ? votesPart : recencyRank;

  const emotional = ['情绪共鸣', '故事叙事', '抖机灵'].includes(s.strategy);
  energy *= params.climate === 'emotional' ? (emotional ? 1.35 : 0.85) : emotional ? 0.85 : 1.15;

  if (params.authorityBoost) energy *= 1 + (s.authority - 1) * 0.12;
  else energy *= 0.92;

  return Math.max(0.02, energy);
}

export function buildLayout(
  species: Species[],
  all: Species[],
  params: { rankMode: 'votes' | 'recent'; climate: 'rational' | 'emotional'; authorityBoost: boolean },
  width: number,
  height: number,
): { nodes: VizNode[]; links: VizLink[] } {
  const maxEnergy = Math.max(0.0001, ...species.map((s) => computeEnergy(s, all, params)));
  const nodes: VizNode[] = species.map((s) => {
    const energy = computeEnergy(s, all, params);
    const r = 18 + 46 * Math.sqrt(energy / maxEnergy); // 面积感知半径
    return { ...s, x: width / 2 + (Math.random() - 0.5) * 200, y: height / 2 + (Math.random() - 0.5) * 200, r, energy };
  });

  // 同立场 = 集群连线；对立阵营能量前二 = 竞争虚线
  const links: VizLink[] = [];
  const byStance = new Map<Stance, VizNode[]>();
  for (const n of nodes) {
    const arr = byStance.get(n.stance) || [];
    arr.push(n);
    byStance.set(n.stance, arr);
  }
  for (const arr of byStance.values()) {
    for (let i = 1; i < arr.length; i++) links.push({ source: arr[0], target: arr[i], kind: 'camp' });
  }
  const stanceTotals = [...byStance.entries()]
    .map(([st, arr]) => ({ st, total: arr.reduce((sum, n) => sum + n.energy, 0) }))
    .sort((a, b) => b.total - a.total);
  if (stanceTotals.length >= 2) {
    const a = byStance.get(stanceTotals[0].st)![0];
    const b = byStance.get(stanceTotals[1].st)![0];
    if (a && b) links.push({ source: a, target: b, kind: 'rival' });
  }

  const sim = forceSimulation<VizNode>(nodes)
    .force('charge', forceManyBody<VizNode>().strength(-320))
    .force(
      'link',
      forceLink<VizNode, VizLink>(links)
        .id((d) => d.id)
        .distance((l) => (l.kind === 'rival' ? 190 : 110))
        .strength(0.25),
    )
    .force('center', forceCenter(width / 2, height / 2))
    .force('collide', forceCollide<VizNode>((d) => d.r + 8))
    .stop();

  for (let i = 0; i < 300; i++) sim.tick();
  // 边界收拢
  for (const n of nodes) {
    n.x = Math.max(n.r + 12, Math.min(width - n.r - 12, n.x));
    // 底部预留从 12 提到 84：图例条（立场 6 项 + 策略 6 项会折成两行，约 62px）
    // 绝对定位压在画布底部，Top3 标签又画在圆下方 r+16 处，
    // 余量太小会让节点和标签一起沉到图例底下（纯布局参数，能量公式未动）
    n.y = Math.max(n.r + 34, Math.min(height - n.r - 84, n.y));
  }
  return { nodes, links };
}
