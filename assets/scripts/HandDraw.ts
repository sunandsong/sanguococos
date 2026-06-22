import { Graphics } from 'cc';

// 手绘风线条助手：把直线/圆弧画成带稳定抖动的“手绘”样子。
// 抖动量由两端坐标算出（不随时间变），所以不会闪。

function seedBow(a: number, b: number, c: number, d: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 11.317) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;   // -1..1 稳定
}

/** 手绘直线：中点沿垂直方向轻微外凸 */
export function hLine(g: Graphics, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;          // 垂直方向
  const bow = Math.min(6, len * 0.06) * seedBow(x0, y0, x1, y1);
  const mx = (x0 + x1) / 2 + nx * bow;
  const my = (y0 + y1) / 2 + ny * bow;
  g.moveTo(x0, y0);
  g.quadraticCurveTo(mx, my, x1, y1);
}

/** 手绘折线（一串点） */
export function hPoly(g: Graphics, pts: number[][], close = false) {
  for (let i = 0; i < pts.length - 1; i++) hLine(g, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  if (close && pts.length > 1) hLine(g, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
}

/** 手绘圆/弧：把弧采样成若干段，半径带轻微抖动 */
export function hArc(g: Graphics, cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, segs = 18) {
  const step = (a1 - a0) / segs;
  for (let i = 0; i <= segs; i++) {
    const a = a0 + step * i;
    const rr = r * (1 + 0.03 * seedBow(cx, cy, a * 100, r));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
}
