import {
  _decorator,
  Component,
  Node,
  Sprite,
  SpriteFrame,
  Label,
  resources,
  view,
  UITransform,
  Color,
  UIOpacity,
  tween,
  Vec3,
} from "cc";
import { GameState } from "./GameState";
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

const CROPS = [
  { id: "rice", name: "稻", sec: 30, yield: 200, tier: 0 },
  { id: "wheat", name: "麦", sec: 90, yield: 800, tier: 1 },
  { id: "millet", name: "粟", sec: 240, yield: 3000, tier: 2 },
  { id: "xiangdao", name: "香稻", sec: 600, yield: 10000, tier: 3 },
];

interface Plot {
  node: Node;
  sp: Sprite;
  crop: Node;
  cropUI: UITransform;
  cropSp: Sprite;
  plantedAt: number;
  cropIdx: number;
}

// 田地：点空田选作物 → 长苗 → 熟了点收获 +粮（照 H5）。
@ccclass("Farms")
export class Farms extends Component {
  @property
  count = 4;
  @property
  farmScale = 0.34;
  @property
  farmFy = 0.64;   // 越小越往上
  @property
  gapFx = 0.17;
  // —— 苗 ——
  @property
  cropW = 340; // 苗整体宽（铺满田宽）
  @property
  cropH = 300; // 苗满高时的高度
  @property
  cropStart = 0.5; // 种下时的起步高度比例（0~1）
  @property
  cropOffsetY = -70; // 苗在田里的上下位置（越小越靠上）

  private plots: Plot[] = [];
  private farmSF: SpriteFrame | null = null;
  private plantedSF: SpriteFrame | null = null;
  private cropSF: SpriteFrame | null = null;
  private picker!: Node;
  private pendingPlot = -1;
  private W = 0;
  private H = 0;

  onLoad() {
    const sz = { width: DESIGN_W, height: DESIGN_H };
    this.W = sz.width;
    this.H = sz.height;
    resources.load("crop/spriteFrame", SpriteFrame, (e, sf) => {
      if (!e) this.cropSF = sf;
      this.refreshCrops();
    });
    resources.load("farm-planted/spriteFrame", SpriteFrame, (e, sf) => {
      if (!e) this.plantedSF = sf;
    });
    resources.load("farm/spriteFrame", SpriteFrame, (e, sf) => {
      if (e) {
        console.warn("farm 加载失败", e);
        return;
      }
      this.farmSF = sf;
      this.buildPlots();
    });
    this.buildPicker();
  }

  private buildPlots() {
    const startFx = 0.5 - ((this.count - 1) * this.gapFx) / 2;
    for (let i = 0; i < this.count; i++) {
      const fx = startFx + i * this.gapFx;
      const node = new Node("farm" + i);
      node.layer = this.node.layer;
      node.parent = this.node;
      const ui = node.addComponent(UITransform);
      ui.setAnchorPoint(0.5, 0.5);
      const sp = node.addComponent(Sprite);
      sp.spriteFrame = this.farmSF!;
      sp.sizeMode = Sprite.SizeMode.TRIMMED;
      // sp 存到 plot，用于种植时换图
      node.setScale(this.farmScale, this.farmScale, 1);
      node.setPosition((fx - 0.5) * this.W, (0.5 - this.farmFy) * this.H, 0);
      // 作物（子节点，底部锚，按进度纵向长高）
      const crop = new Node("crop");
      crop.layer = this.node.layer;
      crop.parent = node;
      const cui = crop.addComponent(UITransform);
      cui.setAnchorPoint(0.5, 0);
      const csp = crop.addComponent(Sprite);
      csp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (this.cropSF) csp.spriteFrame = this.cropSF;
      crop.setPosition(0, this.cropOffsetY, 0); // 田中（cropOffsetY 越小越靠上）
      crop.active = false;
      const idx = i;
      node.on(Node.EventType.TOUCH_END, () => this.onPlotTap(idx), this);
      this.plots.push({
        node,
        sp,
        crop,
        cropUI: cui,
        cropSp: csp,
        plantedAt: 0,
        cropIdx: -1,
      });
    }
  }

  private refreshCrops() {
    for (const p of this.plots)
      if (this.cropSF) p.cropSp.spriteFrame = this.cropSF;
  }

  private cityTier(): number {
    return Math.max(0, Math.min(3, GameState.i.level - 1));
  }

  private onPlotTap(i: number) {
    const p = this.plots[i];
    if (!p.plantedAt) {
      this.openPicker(i);
      return;
    }
    const crop = CROPS[p.cropIdx];
    const elapsed = (Date.now() - p.plantedAt) / 1000;
    if (elapsed >= crop.sec) {
      // 收获
      GameState.i.food += crop.yield;
      this.harvestFx(p.node.position.x, p.node.position.y, crop.yield);
      // 麦苗弹一下再消失
      tween(p.crop)
        .to(0.1, { scale: new Vec3(1.25, 1.25, 1) })
        .to(0.12, { scale: new Vec3(0, 0, 1) })
        .call(() => { p.crop.active = false; p.crop.setScale(1, 1, 1); })
        .start();
      p.plantedAt = 0;
      p.cropIdx = -1;
      if (this.farmSF) p.sp.spriteFrame = this.farmSF; // 收获后换回带横杠的空田
    }
    // 没熟：什么也不做
  }

  // ===== 收获动画：金粒上飞 + “+粮”文字 =====
  private grains: { n: Node; op: UIOpacity; vx: number; vy: number; t: number }[] = [];

  private harvestFx(x: number, y: number, yld: number) {
    // “+粮”文字上升淡出
    const lN = new Node('plus'); lN.layer = this.node.layer; lN.parent = this.node; lN.addComponent(UITransform);
    const l = lN.addComponent(Label); l.string = `+${yld}粮`; l.fontSize = 26; l.color = new Color(240, 200, 70, 255);
    lN.addComponent(UIOpacity);
    lN.setPosition(x, y + 20, 0);
    tween(lN).by(0.8, { position: new Vec3(0, 90, 0) }).start();
    tween(lN.getComponent(UIOpacity)!).delay(0.3).to(0.5, { opacity: 0 }).call(() => lN.destroy()).start();
    // 金色粮粒四射上飞
    for (let i = 0; i < 8; i++) {
      const g = new Node('grain'); g.layer = this.node.layer; g.parent = this.node;
      g.addComponent(UITransform).setContentSize(12, 12);
      const sp = g.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.color = new Color(240, 200, 70, 255);
      resources.load('white/spriteFrame', SpriteFrame, (e, sf) => { if (!e) sp.spriteFrame = sf; });
      const op = g.addComponent(UIOpacity);
      g.setPosition(x, y, 0);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const spd = 120 + Math.random() * 120;
      this.grains.push({ n: g, op, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd + 120, t: 0 });
    }
  }

  // ===== 作物选单 =====
  private buildPicker() {
    this.picker = new Node("picker");
    this.picker.layer = this.node.layer;
    this.picker.parent = this.node;
    this.picker.addComponent(UITransform).setContentSize(this.W, this.H);
    // 半透明背景（点它关闭）
    const bg = new Node("bg");
    bg.layer = this.node.layer;
    bg.parent = this.picker;
    const bgui = bg.addComponent(UITransform);
    bgui.setContentSize(this.W, this.H);
    const bgsp = bg.addComponent(Sprite);
    bgsp.sizeMode = Sprite.SizeMode.CUSTOM;
    bgsp.color = new Color(0, 0, 0, 150);
    resources.load("white/spriteFrame", SpriteFrame, (e, sf) => {
      if (!e) bgsp.spriteFrame = sf;
    });
    bg.on(
      Node.EventType.TOUCH_END,
      () => {
        this.picker.active = false;
      },
      this,
    );
    // 标题
    const titleN = new Node("t");
    titleN.layer = this.node.layer;
    titleN.parent = this.picker;
    titleN.addComponent(UITransform);
    const title = titleN.addComponent(Label);
    title.string = "选择粮种";
    title.fontSize = 30;
    title.color = new Color(255, 255, 255, 255);
    titleN.setPosition(0, 200, 0);
    this.picker.active = false;
  }

  private openPicker(i: number) {
    this.pendingPlot = i;
    // 清掉旧按钮（保留 bg 和 title）
    this.picker.children.slice(2).forEach((c) => c.destroy());
    const tier = this.cityTier();
    CROPS.forEach((c, ci) => {
      const locked = tier < c.tier;
      const btn = new Node("btn");
      btn.layer = this.node.layer;
      btn.parent = this.picker;
      const bui = btn.addComponent(UITransform);
      bui.setContentSize(420, 64);
      bui.setAnchorPoint(0.5, 0.5);
      const sp = btn.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.color = locked
        ? new Color(120, 120, 120, 255)
        : new Color(250, 244, 230, 255);
      resources.load("white/spriteFrame", SpriteFrame, (e, sf) => {
        if (!e) sp.spriteFrame = sf;
      });
      btn.setPosition(0, 120 - ci * 76, 0);
      const lN = new Node("l");
      lN.layer = this.node.layer;
      lN.parent = btn;
      lN.addComponent(UITransform);
      const l = lN.addComponent(Label);
      l.string = locked
        ? `${c.name}（需城池升级）`
        : `${c.name}  ${c.sec}s  +${c.yield}粮`;
      l.fontSize = 24;
      l.color = new Color(
        locked ? 230 : 40,
        locked ? 230 : 30,
        locked ? 230 : 20,
        255,
      );
      if (!locked)
        btn.on(
          Node.EventType.TOUCH_END,
          (e: any) => {
            e.propagationStopped = true;
            this.plant(ci);
          },
          this,
        );
    });
    this.picker.active = true;
  }

  private plant(cropIdx: number) {
    const p = this.plots[this.pendingPlot];
    if (p) {
      p.plantedAt = Date.now();
      p.cropIdx = cropIdx;
      p.crop.active = true;
      if (this.plantedSF) p.sp.spriteFrame = this.plantedSF; // 种植时换成无横杠田
    }
    this.picker.active = false;
  }

  update(dt: number) {
    for (const p of this.plots) {
      if (!p.plantedAt) continue;
      const crop = CROPS[p.cropIdx];
      const ratio = Math.min(1, (Date.now() - p.plantedAt) / 1000 / crop.sec);
      const ready = ratio >= 1;
      // 苗：宽 cropW，高从 cropStart 起步长到满高 cropH
      const grow = this.cropStart + (1 - this.cropStart) * ratio;
      p.cropUI.setContentSize(this.cropW, this.cropH * grow);
      p.cropSp.color = ready
        ? new Color(232, 192, 70, 255)
        : new Color(86, 160, 70, 255);
    }
    // 收获金粒：上抛 + 重力 + 淡出
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const g = this.grains[i]; g.t += dt;
      g.vy -= 260 * dt;                       // 重力
      g.n.setPosition(g.n.position.x + g.vx * dt, g.n.position.y + g.vy * dt, 0);
      g.op.opacity = Math.max(0, 255 * (1 - g.t / 0.9));
      if (g.t >= 0.9) { g.n.destroy(); this.grains.splice(i, 1); }
    }
  }
}
