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

  // 三阶段：标题 → 绘本剧情（逐页点击）→ 出征
  private phase = 0;   // 0=标题 1=剧情
  private dismiss() {
    if (this.leaving) return;
    if (this.phase === 0) { this.phase = 1; this.showStory(); return; }
    if (this.nextPage()) return;   // 还有下一页 → 翻页；翻完才出征
    this.leaving = true;
    // 首页独立场景:此刻才创建战场节点(标题/剧情期间战场不存在、不耗资源)
    const bn = new Node('Battle');
    bn.layer = this.node.layer; bn.parent = this.node.parent!;
    bn.addComponent(UITransform);
    bn.addComponent(BattleScene);
    BattleScene.instance?.open();
    const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
    tween(op).to(0.45, { opacity: 0 })
      .call(() => this.node.destroy())
      .start();
  }

  // ── 开场剧情（单页海报 + 字幕）──
  private readonly STORY: { res: string; text: string }[] = [
    {
      res: 'story-1',
      text: '昭昭无病无灾，一夜魂散——\n她的名字，被天庭朱笔从生死簿上勾去了。\n云中不认这个命。\n「下黄泉，上碧落，我只问一句：凭什么。」',
    },
  ];
  private storyIdx = -1;
  private pageSp: Sprite | null = null;
  private pageOp: UIOpacity | null = null;
  private capLbl: Label | null = null;
  private capOp: UIOpacity | null = null;
  private pageNumLbl: Label | null = null;

  /** 进入剧情模式：压暗标题层，翻第一页 */
  private showStory() {
    const W = DESIGN_W, H = DESIGN_H;
    for (const name of ['logo', 'sub', 'sublines', 'start', 'ver']) {
      const n = this.node.getChildByName(name);
      if (!n) continue;
      const op = n.getComponent(UIOpacity) || n.addComponent(UIOpacity);
      tween(op).to(0.35, { opacity: 0 }).start();
    }
    // 黑底（图之间的换页底色，也是缺图时的兜底）
    const dim = new Node('storydim');
    dim.layer = this.node.layer; dim.parent = this.node;
    dim.addComponent(UITransform);
    const dg = dim.addComponent(Graphics);
    dg.fillColor = new Color(6, 4, 16, 255);
    dg.rect(-W / 2, -H / 2, W, H); dg.fill();
    const dimOp = dim.addComponent(UIOpacity); dimOp.opacity = 0;
    tween(dimOp).to(0.4, { opacity: 255 }).start();

    // 插画页（全屏）
    const page = new Node('storypage');
    page.layer = this.node.layer; page.parent = this.node;
    page.addComponent(UITransform).setContentSize(W, H);
    this.pageSp = page.addComponent(Sprite);
    this.pageSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.pageOp = page.addComponent(UIOpacity); this.pageOp.opacity = 0;

    // 底部字幕（描边白字，多行）
    const cap = new Node('storycap');
    cap.layer = this.node.layer; cap.parent = this.node;
    cap.addComponent(UITransform);
    this.capLbl = cap.addComponent(Label);
    this.capLbl.fontSize = 30; this.capLbl.lineHeight = 46;
    this.capLbl.color = new Color(244, 238, 248, 255);
    this.capLbl.horizontalAlign = Label.HorizontalAlign.CENTER;
    const col = cap.addComponent(LabelOutline); col.color = new Color(8, 6, 20, 255); col.width = 4;
    cap.setPosition(0, -450, 0);   // 4 行文案沉到画面底部水面区，不压人物
    this.capOp = cap.addComponent(UIOpacity); this.capOp.opacity = 0;

    // 页码 + 翻页提示
    const pn = new Node('storynum');
    pn.layer = this.node.layer; pn.parent = this.node;
    pn.addComponent(UITransform);
    this.pageNumLbl = pn.addComponent(Label);
    this.pageNumLbl.fontSize = 20; this.pageNumLbl.lineHeight = 24;
    this.pageNumLbl.color = new Color(180, 160, 200, 210);
    pn.setPosition(0, -590, 0);

    this.scheduleOnce(() => this.nextPage(), 0.35);
  }

  /** 翻页；最后一页之后出征 */
  private nextPage(): boolean {
    this.storyIdx++;
    if (this.storyIdx >= this.STORY.length) return false;   // 翻完了
    const pg = this.STORY[this.storyIdx];
    // 换图：旧图淡出 → 新图淡入（缺图时保持黑底，只上字幕）
    if (this.pageOp) this.pageOp.opacity = 0;
    resources.load(pg.res + '/spriteFrame', SpriteFrame, (e, sf) => {
      if (!this.node.isValid || !this.pageSp || !this.pageOp) return;
      if (e || !sf || this.STORY[this.storyIdx]?.res !== pg.res) return;   // 已翻走的旧回调丢弃
      this.pageSp.spriteFrame = sf;
      tween(this.pageOp).to(0.55, { opacity: 255 }).start();
    });
    // 字幕淡入
    if (this.capLbl && this.capOp) {
      this.capLbl.string = pg.text;
      this.capOp.opacity = 0;
      tween(this.capOp).delay(0.35).to(0.6, { opacity: 255 }).start();
    }
    if (this.pageNumLbl) {
      this.pageNumLbl.string = this.STORY.length > 1
        ? `${this.storyIdx + 1} / ${this.STORY.length}　·　点击继续 ▸`
        : '点 击 启 程 ▸';
    }
    return true;
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
