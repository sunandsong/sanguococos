import {
  _decorator, Component, Node, Graphics, Label, LabelOutline,
  UITransform, UIOpacity, Color, tween, Vec3,
  Sprite, SpriteFrame, Texture2D, resources,
} from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
import { BattleScene } from './BattleScene';
const { ccclass } = _decorator;

// 标题画面《我要上天》：夜空星光 + 天光光柱 + 金字标题 + 点击开始。
// 盖在最上层，点击后整体淡出销毁，露出下面的游戏。
@ccclass('TitleScreen')
export class TitleScreen extends Component {
  private t = 0;
  private starG!: Graphics;
  private beamOp: UIOpacity | null = null;
  private startLbl!: Label;
  private titleNode!: Node;
  private leaving = false;

  onLoad() {
    const W = DESIGN_W, H = DESIGN_H;
    this.node.getComponent(UITransform)!.setContentSize(W, H);
    this.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);

    const child = (name: string) => {
      const n = new Node(name);
      n.layer = this.node.layer;
      n.addComponent(UITransform);
      n.parent = this.node;
      return n;
    };

    // 夜空渐变底（深蓝 → 墨紫，纵向色阶）
    const bg = child('bg').addComponent(Graphics);
    const top = [14, 12, 34], bot = [46, 30, 60], bands = 18, bh = H / bands;
    for (let i = 0; i < bands; i++) {
      const k = i / (bands - 1);
      bg.fillColor = new Color(
        Math.round(bot[0] + (top[0] - bot[0]) * k),
        Math.round(bot[1] + (top[1] - bot[1]) * k),
        Math.round(bot[2] + (top[2] - bot[2]) * k), 255);
      bg.rect(-W / 2, -H / 2 + i * bh, W, bh + 1); bg.fill();
    }

    // 星星（update 里闪烁重画）
    this.starG = child('stars').addComponent(Graphics);

    // 天光光柱（托着标题，呼吸明暗）
    const beamN = child('beam');
    beamN.getComponent(UITransform)!.setContentSize(640, 355);
    beamN.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
    const beamSp = beamN.addComponent(Sprite); beamSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.beamOp = beamN.addComponent(UIOpacity);
    beamN.setPosition(0, 120, 0);
    beamN.setScale(1.15, 3.2, 1);
    resources.load('fx-light-beam/spriteFrame', SpriteFrame, (e, sf) => {
      if (!beamN.isValid) return;   // 标题已被点击销毁，迟到的加载回调直接丢弃（防 _uiProps null 崩溃）
      if (e || !sf) { beamN.active = false; return; }
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      beamSp.spriteFrame = sf;
    });

    // 标题「我要上天」
    this.titleNode = child('title');
    const tl = this.titleNode.addComponent(Label);
    tl.string = '我要上天';
    tl.fontSize = 128; tl.lineHeight = 136; tl.isBold = true;
    tl.color = new Color(255, 216, 92, 255);
    const ol = this.titleNode.addComponent(LabelOutline);
    ol.color = new Color(84, 34, 16, 255); ol.width = 6;
    this.titleNode.setPosition(0, 240, 0);
    // 入场：微缩放落定 + 淡入
    const tOp = this.titleNode.addComponent(UIOpacity); tOp.opacity = 0;
    this.titleNode.setScale(1.18, 1.18, 1);
    tween(tOp).to(0.7, { opacity: 255 }).start();
    tween(this.titleNode).to(0.7, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();

    // 副标题
    const sub = child('sub');
    const sl = sub.addComponent(Label);
    sl.string = '碧 落 黄 泉';
    sl.fontSize = 34; sl.lineHeight = 40;
    sl.color = new Color(196, 176, 150, 255);
    const sol = sub.addComponent(LabelOutline); sol.color = new Color(20, 16, 24, 255); sol.width = 3;
    sub.setPosition(0, 138, 0);

    // 点击开始（呼吸闪烁）
    const start = child('start');
    this.startLbl = start.addComponent(Label);
    this.startLbl.string = '— 点 击 开 始 —';
    this.startLbl.fontSize = 36; this.startLbl.lineHeight = 42;
    this.startLbl.color = new Color(235, 228, 210, 255);
    const stol = start.addComponent(LabelOutline); stol.color = new Color(20, 16, 24, 255); stol.width = 3;
    start.setPosition(0, -300, 0);

    // 整屏点击 → 淡出销毁
    this.node.on(Node.EventType.TOUCH_END, () => this.dismiss(), this);
  }

  private dismiss() {
    if (this.leaving) return;
    this.leaving = true;
    BattleScene.instance?.open();   // 主城已去掉：点击标题直接出征
    const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
    tween(op).to(0.45, { opacity: 0 })
      .call(() => this.node.destroy())
      .start();
  }

  update(dt: number) {
    this.t += dt;
    // 星星闪烁
    const g = this.starG, W = DESIGN_W, H = DESIGN_H;
    g.clear();
    for (let i = 0; i < 46; i++) {
      const x = ((i * 211.7) % W) - W / 2;
      const y = ((i * 137.3) % (H * 0.9)) - H * 0.45;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.t * (0.6 + (i % 5) * 0.3) + i));
      g.fillColor = new Color(230, 236, 255, Math.round(190 * tw));
      g.circle(x, y, 1.2 + (i % 3) * 0.8); g.fill();
    }
    // 光柱呼吸
    if (this.beamOp) this.beamOp.opacity = Math.round(120 + 70 * Math.sin(this.t * 0.9));
    // 标题浮动
    if (this.titleNode && !this.leaving) this.titleNode.setPosition(0, 240 + Math.sin(this.t * 1.1) * 6, 0);
    // 点击开始呼吸
    if (this.startLbl) {
      const a = 0.45 + 0.55 * Math.abs(Math.sin(this.t * 1.6));
      this.startLbl.color = new Color(235, 228, 210, Math.round(255 * a));
    }
  }
}
