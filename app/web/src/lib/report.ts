import type { Ecosystem, ReleaseReport, Species } from '../types';
import { STANCE_COLORS } from '../types';

// 生态报告：纯 SVG 生成（无外部资源，可安全导出 PNG）
export function buildReportSvg(eco: Ecosystem, release: ReleaseReport | null, sourceLabel: string): string {
  const W = 800;
  const H = 1080;
  const species = [...eco.species].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
  const maxVotes = Math.max(1, ...species.map((s) => s.votes ?? 0));

  const strategyCount = new Map<string, number>();
  for (const s of eco.species) strategyCount.set(s.strategy, (strategyCount.get(s.strategy) || 0) + 1);
  const strategies = [...strategyCount.entries()].sort((a, b) => b[1] - a[1]);
  const maxStrat = Math.max(1, ...strategies.map((s) => s[1]));

  const esc = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dt = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

  let y = 150;
  const parts: string[] = [];

  // 头部
  parts.push(`<text x="48" y="72" font-size="26" font-weight="600" fill="#1a1a1a">观点进化图谱</text>`);
  parts.push(`<text x="48" y="100" font-size="14" fill="#666">${esc(eco.question)}</text>`);
  parts.push(
    `<text x="48" y="126" font-size="12" fill="#999">生成于 ${new Date().toLocaleString('zh-CN')} · 采集 ${species.length} 个观点物种 · 数据来源：${esc(sourceLabel)}</text>`,
  );
  parts.push(`<line x1="48" y1="142" x2="${W - 48}" y2="142" stroke="#e0ded6" stroke-width="1"/>`);

  // 生态剖面
  parts.push(`<text x="48" y="${y}" font-size="16" font-weight="500" fill="#333">生态剖面</text>`);
  y += 26;
  const narrative = eco.narrative || '（暂无叙事）';
  for (const line of wrap(narrative, 44)) {
    parts.push(`<text x="48" y="${y}" font-size="13" fill="#555">${esc(line)}</text>`);
    y += 22;
  }
  y += 16;

  // 物种能量排行（Top 6）
  parts.push(`<text x="48" y="${y}" font-size="16" font-weight="500" fill="#333">物种能量排行 · Top ${Math.min(6, species.length)}</text>`);
  y += 14;
  for (const s of species.slice(0, 6)) {
    y += 34;
    const c = STANCE_COLORS[s.stance];
    const v = s.votes ?? 0;
    const bw = 380 * (v / maxVotes);
    parts.push(`<rect x="48" y="${y - 14}" width="${Math.max(6, bw)}" height="18" rx="4" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.5"/>`);
    parts.push(`<text x="${48 + Math.max(6, bw) + 10}" y="${y}" font-size="12" fill="#444" dominant-baseline="central">${v > 0 ? `${v} 赞同` : '热序'}</text>`);
    parts.push(`<text x="48" y="${y + 22}" font-size="12" fill="#333">${esc(`[${s.stance}·${s.strategy}] ${s.summary || s.author}`)}</text>`);
    y += 26;
  }
  y += 14;

  // 生存策略分布
  parts.push(`<text x="48" y="${y}" font-size="16" font-weight="500" fill="#333">生存策略分布</text>`);
  y += 16;
  for (const [name, count] of strategies) {
    y += 26;
    const bw = 300 * (count / maxStrat);
    parts.push(`<rect x="48" y="${y - 12}" width="${Math.max(6, bw)}" height="14" rx="4" fill="#B5D4F4" stroke="#185FA5" stroke-width="0.5"/>`);
    parts.push(`<text x="${48 + Math.max(6, bw) + 10}" y="${y - 5}" font-size="12" fill="#444" dominant-baseline="central">${name} × ${count}</text>`);
  }
  y += 30;

  // 放生实验结果
  if (release) {
    parts.push(`<line x1="48" y1="${y}" x2="${W - 48}" y2="${y}" stroke="#e0ded6" stroke-width="1"/>`);
    y += 34;
    parts.push(`<text x="48" y="${y}" font-size="16" font-weight="500" fill="#333">放生实验 · 生存预测</text>`);
    y += 40;
    const p = release.survivalProbability;
    parts.push(`<rect x="48" y="${y - 18}" width="560" height="20" rx="6" fill="#F1EFE8"/>`);
    parts.push(`<rect x="48" y="${y - 18}" width="${560 * (p / 100)}" height="20" rx="6" fill="${p >= 50 ? '#9FE1CB' : '#F5C4B3'}" stroke="${p >= 50 ? '#0F6E56' : '#993C1D'}" stroke-width="0.5"/>`);
    parts.push(`<text x="620" y="${y - 8}" font-size="18" font-weight="600" fill="#1a1a1a">${p}%</text>`);
    y += 16;
    parts.push(`<text x="48" y="${y + 16}" font-size="12" fill="#666">${esc(`判定：${release.narrative}`)}</text>`);
    y += 34;
    parts.push(`<text x="48" y="${y}" font-size="12" fill="#888">压力来源：${esc(release.suppressedBy)}</text>`);
    y += 24;
    for (const adv of release.hybridAdvice.slice(0, 3)) {
      parts.push(`<text x="48" y="${y}" font-size="12" fill="#555">${esc('· ' + adv)}</text>`);
      y += 22;
    }
    y += 10;
  }

  // 底部水印
  parts.push(`<line x1="48" y1="${H - 72}" x2="${W - 48}" y2="${H - 72}" stroke="#e0ded6" stroke-width="1"/>`);
  parts.push(`<text x="48" y="${H - 44}" font-size="12" fill="#999">观点进化缸 · Opinion Evolution Tank</text>`);
  parts.push(`<text x="48" y="${H - 24}" font-size="11" fill="#aaa">时间轴为 AI 演化重建 · 放生结果为 AI 模拟预测，非知乎平台数据</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#FDFDFB"/>
  ${parts.join('\n')}
</svg>`;
}

function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if (cur.length >= perLine) {
      lines.push(cur);
      cur = '';
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function downloadSvg(svg: string, filename: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadPng(svg: string, filename: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 渲染失败'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.fillStyle = '#FDFDFB';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngBlob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 导出失败'))), 'image/png'),
    );
    const pngUrl = URL.createObjectURL(pngBlob);
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(pngUrl);
  } finally {
    URL.revokeObjectURL(url);
  }
}
