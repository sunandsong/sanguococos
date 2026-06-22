import { _decorator, Component, view, Node, UIOpacity, tween, Vec3, EventTouch, Sprite, SpriteFrame, resources } from 'cc';
import { GameState } from './GameState';
const { ccclass, property } = _decorator;

// 图片素材版太阳：节点用 Sprite 显示 sun.png，本组件只负责
// 走天空弧线、夜里淡出、点击弹一下。这是“Sprite 角色”的范式。
@ccclass('SunSprite')
export class SunSprite extends Component {
  @property
  sunHorizon = 0.40;   // 升起/落下时的最低点（沉得更深，整个没入山里）
  @property
  sunPeak = 0.13;      // 正午最高点
  @property
  riseLine = 0.28;     // 升起露头线：升到山脊以上才开始渐显
  @property
  setLine = 0.36;      // 落山消失线：沉到山一半（更深）才渐隐消失
  @property
  fadeBand = 0.07;     // 渐显/渐隐过渡宽度

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

  update(dt: number) {
    const gs = GameState.i;
    gs.tick(dt);     // 推进时间（每帧只真正加一次）
    const { width: W, height: H } = view.getVisibleSize();
    // 拂晓东升 → 正午最高 → 黄昏落下
    const up = Math.max(0, Math.min(1, (gs.dayPhase - 0.05) / 0.50));
    const fx = 0.15 + 0.70 * up;
    const fy = this.sunHorizon - (this.sunHorizon - this.sunPeak) * Math.sin(up * Math.PI);
    this.node.setPosition((fx - 0.5) * W, (0.5 - fy) * H, 0);
    // 升起用露头线、落山用更深的消失线（落下时晚一点才渐隐）
    const rising = up < 0.5;
    const line = rising ? this.riseLine : this.setLine;
    let vis = (line - fy) / this.fadeBand;
    vis = Math.max(0, Math.min(1, vis));
    this.op.opacity = Math.round(Math.max(0, 1 - gs.nightLevel) * vis * 255);
  }
}
