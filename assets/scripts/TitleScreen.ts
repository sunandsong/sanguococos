import {
  _decorator, Component, Node, Graphics, Label, LabelOutline,
  UITransform, UIOpacity, Color, tween, Vec3,
  Sprite, SpriteFrame, Texture2D, resources,
} from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
import { BattleScene } from './BattleScene';
const { ccclass } = _decorator;

// 标题画面《我要上天》方案B·梦幻天宫：
// AI 生成的天宫背景(title-bg) + 金字标题(title-logo)，叠程序动效（logo 弹入浮动 / 四芒星星尘 / 依次淡入）。
// 盖在最上层，点击后整体淡出销毁，露出下面的游戏。
@ccclass('TitleScreen')
export class TitleScreen extends Component {
  private t = 0;
  private startLbl!: Label;
  private logoN: Node | null = null;
  private sparks: { n: Node; op: UIOpacity; ph: number; w: number }[] = [];
  private leaving = false;

  private readonly LOGO_Y = -150;    // logo 中心（约屏高 52% 处）

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

    // 兜底底色（背景图加载完成前的一瞬不露黑）
    const bgFill = child('bgfill').addComponent(Graphics);
    bgFill.fillColor = new Color(34, 28, 78, 255);
    bgFill.rect(-W / 2, -H / 2, W, H); bgFill.fill();

    // 天宫背景图（微放大，配合缓慢漂移做“仰望感”）
    const bgN = child('bg');
    bgN.getComponent(UITransform)!.setContentSize(W, H);
    const bgSp = bgN.addComponent(Sprite);
    bgSp.sizeMode = Sprite.SizeMode.CUSTOM;
    bgN.setScale(1.06, 1.06, 1);
    resources.load('title-bg/spriteFrame', SpriteFrame, (e, sf) => {
      if (!bgN.isValid) return;
      if (e || !sf) return;
      bgSp.spriteFrame = sf;
    });

    // 四芒星星尘（金/粉/青三色，闪烁由 update 驱动）
    const cols = [new Color(255, 215, 106, 255), new Color(255, 183, 217, 255), new Color(155, 232, 255, 255)];
    for (let i = 0; i < 14; i++) {
      const n = child('spark' + i);
      const g = n.addComponent(Graphics);
      const c = cols[i % 3];
      const s = 5 + (i % 3) * 2.5;    // 四芒星臂长
      g.fillColor = c;
      g.rect(-1.1, -s, 2.2, s * 2); g.fill();
      g.rect(-s, -1.1, s * 2, 2.2); g.fill();
      n.angle = 45;
      n.setPosition(((i * 67) % 92 - 46) / 100 * W, H / 2 - (6 + (i * 41) % 78) / 100 * H, 0);
      const op = n.addComponent(UIOpacity); op.opacity = 0;
      this.sparks.push({ n, op, ph: i * 0.9, w: 1.6 + (i % 4) * 0.35 });
    }

    // 标题 logo「我要上天」（弹入 → 缓慢浮动）
    const logoN = child('logo');
    logoN.getComponent(UITransform)!.setContentSize(600, 248);
    const logoSp = logoN.addComponent(Sprite);
    logoSp.sizeMode = Sprite.SizeMode.CUSTOM;
    logoN.setPosition(0, this.LOGO_Y, 0);
    const logoOp = logoN.addComponent(UIOpacity); logoOp.opacity = 0;
    this.logoN = logoN;
    resources.load('title-logo/spriteFrame', SpriteFrame, (e, sf) => {
      if (!logoN.isValid) return;
      if (e || !sf) return;
      logoSp.spriteFrame = sf;
    });
    // 入场：放大淡入弹落（位置交给 update 的浮动）
    logoN.setScale(1.6, 1.6, 1);
    tween(logoOp).delay(0.4).to(0.55, { opacity: 255 }).start();
    tween(logoN).delay(0.4).to(0.7, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

    // 副标题「碧 落 黄 泉」+ 两侧装饰线
    const sub = child('sub');
    sub.setPosition(0, -333, 0);
    const sl = sub.addComponent(Label);
    sl.string = '碧 落 黄 泉';
    sl.fontSize = 30; sl.lineHeight = 36;
    sl.color = new Color(253, 241, 255, 255);
    const sol = sub.addComponent(LabelOutline); sol.color = new Color(74, 42, 84, 255); sol.width = 3;
    const lineG = child('sublines').addComponent(Graphics);
    lineG.node.setPosition(0, -333, 0);
    lineG.strokeColor = new Color(232, 191, 224, 200); lineG.lineWidth = 2;
    lineG.moveTo(-190, 0); lineG.lineTo(-110, 0);
    lineG.moveTo(110, 0); lineG.lineTo(190, 0);
    lineG.stroke();
    const subOp = sub.addComponent(UIOpacity); subOp.opacity = 0;
    const lineOp = lineG.node.addComponent(UIOpacity); lineOp.opacity = 0;
    tween(subOp).delay(1.2).to(0.7, { opacity: 255 }).start();
    tween(lineOp).delay(1.2).to(0.7, { opacity: 255 }).start();

    // 点击开始（呼吸闪烁）
    const start = child('start');
    this.startLbl = start.addComponent(Label);
    this.startLbl.string = '— 点 击 开 始 —';
    this.startLbl.fontSize = 34; this.startLbl.lineHeight = 40;
    this.startLbl.color = new Color(255, 255, 255, 0);
    const stol = start.addComponent(LabelOutline); stol.color = new Color(96, 52, 96, 255); stol.width = 3;
    start.setPosition(0, -486, 0);

    // 章节小字
    const ver = child('ver');
    const vl = ver.addComponent(Label);
    vl.string = '第一章 · 人间';
    vl.fontSize = 18; vl.lineHeight = 22;
    vl.color = new Color(185, 143, 192, 220);
    ver.setPosition(0, -596, 0);

    // 整屏点击 → 淡出销毁
    this.node.on(Node.EventType.TOUCH_END, () => this.dismiss(), this);
  }

  private dismiss() {
    if (this.leaving) return;
    this.leaving = true;
    BattleScene.instance?.open();   // 点击标题直接出征
    const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
    tween(op).to(0.45, { opacity: 0 })
      .call(() => this.node.destroy())
      .start();
  }

  update(dt: number) {
    this.t += dt;
    // logo 缓慢上下浮动
    if (this.logoN && !this.leaving) {
      this.logoN.setPosition(0, this.LOGO_Y + Math.sin(this.t * 1.3) * 8, 0);
    }
    // 四芒星闪烁（相位错开：亮起时同时放大）
    for (const s of this.sparks) {
      const k = Math.max(0, Math.sin(this.t * s.w + s.ph));
      s.op.opacity = Math.round(235 * k);
      const sc = 0.45 + 0.55 * k;
      s.n.setScale(sc, sc, 1);
    }
    // 点击开始：1.9s 后开始呼吸
    if (this.t > 1.9) {
      const a = 0.4 + 0.6 * Math.abs(Math.sin((this.t - 1.9) * 1.7));
      this.startLbl.color = new Color(255, 255, 255, Math.round(255 * a));
    }
  }
}
