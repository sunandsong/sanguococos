import { _decorator, Component, Graphics, Color, view } from 'cc';
import { GameState } from './GameState';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 挂在一个全屏的 SkyOverlay 节点上（节点要有 Graphics 组件）。
// 职责：推进全局时间 + 每帧把天空遮罩刷成当前昼夜色。
@ccclass('DayNightController')
export class DayNightController extends Component {
  @property(Graphics)
  overlay: Graphics = null!;   // 拖入本节点的 Graphics

  onLoad() {
    if (!this.overlay) this.overlay = this.getComponent(Graphics) || this.addComponent(Graphics)!;
  }

  update(dt: number) {
    GameState.i.tick(dt);             // 推进时间（每帧只真正加一次）
    const g = this.overlay;
    if (!g) return;
    const W = DESIGN_W, H = DESIGN_H;
    const s = GameState.i.skyAt(GameState.i.dayPhase);
    g.clear();
    if (s.a > 0.001) {
      g.fillColor = new Color(s.c[0], s.c[1], s.c[2], Math.round(s.a * 255));
      g.rect(-W / 2, -H / 2, W, H);
      g.fill();
    }
  }
}
