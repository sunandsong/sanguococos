import { _decorator, Component, Graphics, Color, view } from 'cc';
import { hLine, hPoly, hArc } from './HandDraw';
const { ccclass } = _decorator;

// 手绘线条风的静态城池：山 + 城墙(带垛口) + 城门 + 主公府。
// 以描边为主、几乎不填实色，贴近原网页风格。
@ccclass('Scenery')
export class Scenery extends Component {
  g!: Graphics;

  onLoad() {
    this.g = this.getComponent(Graphics) || this.addComponent(Graphics)!;
    this.draw();
  }

  draw() {
    const { width: W, height: H } = view.getVisibleSize();
    const g = this.g;
    const px = (fx: number) => (fx - 0.5) * W;   // 居中坐标系
    const py = (fy: number) => (0.5 - fy) * H;   // y 轴翻转
    g.clear();

    const INK = new Color(34, 34, 34, 255);

    // 天空交给底层背景图（Background 节点）；山交给 Mountains 节点（mountains.png）。

    // —— 城墙：带透视的盒子 + 垛口（线条为主）——
    const fL = px(0.16), fR = px(0.84);        // 前墙左右
    const bL = px(0.26), bR = px(0.74);        // 后墙左右
    const wTop = py(0.52), wBase = py(0.66);   // 前墙顶/底
    const bTop = py(0.46);                      // 后墙顶
    g.strokeColor = INK;
    g.lineWidth = 3;
    // 前墙面
    hPoly(g, [[fL, wBase], [fL, wTop], [fR, wTop], [fR, wBase]]);
    // 顶面（透视梯形）
    hPoly(g, [[fL, wTop], [bL, bTop], [bR, bTop], [fR, wTop]]);
    g.stroke();
    // 垛口（前墙顶一排小方块）
    g.lineWidth = 2.4;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const x0 = fL + (fR - fL) * (i / n);
      const x1 = fL + (fR - fL) * ((i + 0.55) / n);
      const ty = wTop, ty2 = wTop + (py(0.49) - wTop);
      hPoly(g, [[x0, ty], [x0, ty2], [x1, ty2], [x1, ty]]);
    }
    g.stroke();
    // 城门（拱形洞）
    g.lineWidth = 3;
    const gx0 = px(0.45), gx1 = px(0.55), gyB = wBase, gyT = py(0.585);
    hPoly(g, [[gx0, gyB], [gx0, gyT], [gx1, gyT], [gx1, gyB]]);
    hArc(g, (gx0 + gx1) / 2, gyT, (gx1 - gx0) / 2, Math.PI, Math.PI * 2, 10);
    g.stroke();

    // —— 主公府：屋身 + 三角顶（线条）——
    g.lineWidth = 3;
    const hx0 = px(0.43), hx1 = px(0.57), hyB = py(0.52), hyT = py(0.43);
    hPoly(g, [[hx0, hyB], [hx0, hyT], [hx1, hyT], [hx1, hyB]]);   // 屋身
    hPoly(g, [[px(0.41), hyT], [px(0.50), py(0.36)], [px(0.59), hyT]]); // 屋顶
    g.stroke();
  }
}
