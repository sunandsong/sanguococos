import { Node, Graphics, Color, UITransform, Layers } from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';

// ─────────────────────────────────────────────────────────────
// 跳跃镜头套件:腾空时世界整体拉远(缩小),落地平滑恢复——所有章节共用。
//   用法:场景把「游戏世界」(背景/怪/主角/特效)放进一个 world 容器,UI 别放;
//     this.cam = new CamZoom(world);
//     每帧 this.cam.update(dt, 腾空?, 轴心x, 轴心y);   // 轴心一般=主角附近屏幕坐标
//   可选:CamZoom.edgeFog(uiParent, 色, 透明度) 在 UI 层铺一圈静态雾/暗框,
//     拉远时屏幕四缘被兜住,不露世界边(色跟场景氛围走:雾城=淡雾,洞窟=压暗)。
// ─────────────────────────────────────────────────────────────
export class CamZoom {
  private world: Node;
  private zoom = 1;
  private outScale: number;
  private speed: number;

  constructor(world: Node, opts?: { out?: number; speed?: number }) {
    this.world = world;
    this.outScale = opts?.out ?? 0.9;   // 腾空拉远到多少(0.85 更夸张)
    this.speed = opts?.speed ?? 6;      // 过渡速度(越大越跟手)
  }

  /** 每帧:zoomedOut=是否拉远(一般=腾空);pivotX/Y=缩放轴心(屏幕坐标,可每帧跟主角) */
  update(dt: number, zoomedOut: boolean, pivotX = 0, pivotY = 0) {
    const zt = zoomedOut ? this.outScale : 1;
    this.zoom += (zt - this.zoom) * Math.min(1, dt * this.speed);
    if (Math.abs(this.zoom - 1) > 0.0005) {
      this.world.setScale(this.zoom, this.zoom, 1);
      this.world.setPosition(pivotX * (1 - this.zoom), pivotY * (1 - this.zoom), 0);
    } else if (this.world.scale.x !== 1) {
      this.zoom = 1; this.world.setScale(1, 1, 1); this.world.setPosition(0, 0, 0);
    }
  }

  reset() { this.zoom = 1; this.world.setScale(1, 1, 1); this.world.setPosition(0, 0, 0); }

  /** 静态边缘雾/暗框(画在 UI 层,不随缩放):四缘一圈软椭圆,拉远时不露世界边 */
  static edgeFog(parent: Node, tint = new Color(216, 215, 227, 255), alpha = 30): Node {
    const rnd = (s: number) => ((Math.sin(s * 127.1) * 43758.5) % 1 + 1) % 1;
    const n = new Node('cam-edgefog'); n.layer = Layers.Enum.UI_2D; n.parent = parent; n.addComponent(UITransform);
    const g = n.addComponent(Graphics);
    for (let i = 0; i < 9; i++) {   // 左右各一列
      const yy = -H / 2 + (i / 8) * H, sd = rnd(i * 3.7);
      g.fillColor = new Color(tint.r, tint.g, tint.b, alpha);
      g.ellipse(-W / 2 - 20, yy, 90 + sd * 50, 70 + sd * 40); g.fill();
      g.ellipse(W / 2 + 20, yy, 90 + sd * 50, 70 + sd * 40); g.fill();
    }
    for (let i = 0; i < 7; i++) {   // 上下各一排
      const xx = -W / 2 + (i / 6) * W, sd = rnd(i * 5.3 + 40);
      g.fillColor = new Color(tint.r, tint.g, tint.b, Math.max(0, alpha - 4));
      g.ellipse(xx, H / 2 + 16, 110 + sd * 60, 60 + sd * 30); g.fill();
      g.ellipse(xx, -H / 2 - 16, 110 + sd * 60, 60 + sd * 30); g.fill();
    }
    return n;
  }
}
