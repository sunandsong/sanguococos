import { _decorator, Component, view, Node, UIOpacity, tween, Vec3, EventTouch, Sprite, SpriteFrame, resources } from 'cc';
import { GameState } from './GameState';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 图片素材版太阳：节点用 Sprite 显示 sun.png，本组件只负责
// 走天空弧线、夜里淡出、点击弹一下。这是“Sprite 角色”的范式。
@ccclass('SunSprite')
export class SunSprite extends Component {
  // ==================== 🌞 太阳调节参数（都在这里） ====================
  @property
  debugLock = false;   // ⚙️ 调试：true=锁在起点；同时勾下面 debugLockEnd=锁在终点
  @property
  debugLockEnd = false; // ⚙️ true=锁在落下位置 (sunEndFx, sunSetLow)；先勾上 debugLock
  @property
  sunStartFx = 0.15;   // 📍 升起的横向起点（0=最左 1=最右）
  @property
  sunEndFx = 0.90;     // 📍 落下的横向终点
  @property
  sunRiseLow = 0.33;   // ⬇️ 升起时的最低点（数字越大沉得越深）
  @property
  sunSetLow = 0.33;    // ⬇️ 落下时的最低点（可以跟升起不同，做成"东升西斜"）
  @property
  sunPeak = 0.13;      // ⬆️ 正午最高点
  @property
  riseLine = 0.28;     // 🔆 升起露头线：升到山脊以上才开始渐显
  @property
  setLine = 0.33;      // 🌅 落山消失线：沉到 0.33 完全消失（与 sunSetLow 对齐）
  @property
  fadeBand = 0.035;    // 🌫️ 渐显/渐隐过渡宽度（越小，太阳/月亮切换越干脆）
  // ====================================================================

  op!: UIOpacity;

  onLoad() {
    this.op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity)!;
    const sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    sp.sizeMode = Sprite.SizeMode.TRIMMED;
    resources.load('sun/spriteFrame', SpriteFrame, (err, sf) => {
      if (!err) sp.spriteFrame = sf; else console.warn('sun 加载失败：', err);
    });
    this.node.on(Node.EventType.TOUCH_END, this.onTap, this);
  }

  onTap(_e: EventTouch) {
    // 点击弹一下（缩放回弹）
    tween(this.node)
      .to(0.08, { scale: new Vec3(1.18, 1.18, 1) })
      .to(0.12, { scale: new Vec3(1, 1, 1) })
      .start();
  }

  private _toppedFrames = 0;
  start() {
    this._toppedFrames = 0;   // 让 update 前几帧持续置顶（保证盖住所有兄弟）
  }

  update(dt: number) {
    const gs = GameState.i;
    gs.tick(dt);
    const W = DESIGN_W, H = DESIGN_H;
    if (this.debugLock) {
      // 调试模式：默认锁起点；勾 debugLockEnd 锁终点
      const fx = this.debugLockEnd ? this.sunEndFx : this.sunStartFx;
      const fy = this.debugLockEnd ? this.sunSetLow  : this.sunRiseLow;
      this.node.setPosition((fx - 0.5) * W, (0.5 - fy) * H, 0);
      this.op.opacity = 255;
      return;
    }
    // 太阳「升起→正午→落下」窗口：dayPhase 从 0.80（夜末）开始爬升，
    // 让月亮淡出的瞬间（≈0.98）太阳刚好露出地平线，无缝接力。
    const sunStartPhase = 0.80;
    const sunWindow = 0.70;
    let rel = (gs.dayPhase - sunStartPhase + 1) % 1;
    const up = rel < sunWindow ? rel / sunWindow : (rel < sunWindow + 0.5 ? 1 : 0);
    const fx = this.sunStartFx + (this.sunEndFx - this.sunStartFx) * up;
    // 起点最低 = sunRiseLow，终点最低 = sunSetLow，正午最高 = sunPeak
    const lowAtUp = this.sunRiseLow + (this.sunSetLow - this.sunRiseLow) * up;
    const fy = lowAtUp - (lowAtUp - this.sunPeak) * Math.sin(up * Math.PI);
    this.node.setPosition((fx - 0.5) * W, (0.5 - fy) * H, 0);
    gs.sunFy = fy;                                   // 给月亮用：太阳当前高度
    const rising = up < 0.5;
    const line = rising ? this.riseLine : this.setLine;
    let vis = (line - fy) / this.fadeBand;
    vis = Math.max(0, Math.min(1, vis));
    gs.sunVis = vis;                 // 给月亮用：月亮=1−sunVis
    this.op.opacity = Math.round(vis * 255);
  }
}
