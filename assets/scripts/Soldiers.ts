import { _decorator, Component, Node, Sprite, SpriteFrame, resources, view, UITransform } from 'cc';
const { ccclass, property } = _decorator;

interface SoldierInst {
  hit: Node;            // 点击容器
  bodySp: Sprite;       // 无头身子
  headSp: Sprite;       // 头（正常/凸眼）
  body0: SpriteFrame | null;
  body1: SpriteFrame | null;
  nhead: SpriteFrame | null;
  phead: SpriteFrame | null;
  headNode: Node;
  baseX: number;
  baseY: number;
  phase: number;
  pokeUntil: number;
}

// 城外脸谱兵：无头身子(两帧走路) + 头(叠在上面)。点击 → 头换凸眼大头并放大，盖住身子。
@ccclass('Soldiers')
export class Soldiers extends Component {
  @property
  soldierScale = 0.1;
  @property
  groundFy = 0.78;       // 兵所在高度（容器中心）
  @property
  childY = 0;            // 身子/头图相对容器的上下微调
  @property
  sway = 24;
  @property
  walkFps = 3;
  @property
  pokeDur = 0.4;
  @property
  headPop = 0.9;         // 凸眼时头放大倍数
  @property
  headDy = 300;          // 头相对身子的上下偏移（正=往上；单位大，屏幕约 ×0.1）

  private list: SoldierInst[] = [];
  private t = 0;

  onLoad() {
    const { width: W, height: H } = view.getVisibleSize();
    const baseY = (0.5 - this.groundFy) * H;
    // [图前缀, 横向 fx, 节奏相位, 头上下偏移]（每个兵单独调头）
    const defs: [string, number, number, number][] = [
      ['soldier-black', 0.28, 0, 300],
      ['soldier-white', 0.50, 1.5, 420],   // 白脸单独再高一点
      ['soldier-red', 0.72, 3.0, 300],
    ];
    defs.forEach(([prefix, fx, phase, hdy]) => this.build(prefix, (fx - 0.5) * W, baseY, phase, hdy));
  }

  private build(prefix: string, baseX: number, baseY: number, phase: number, hdy: number) {
    // 点击容器（小尺寸命中区）
    const hit = new Node(prefix); hit.layer = this.node.layer; hit.parent = this.node;
    const hui = hit.addComponent(UITransform); hui.setAnchorPoint(0.5, 0.5); hui.setContentSize(130, 220);
    hit.setScale(this.soldierScale, this.soldierScale, 1);
    hit.setPosition(baseX, baseY, 0);

    // 身子（600x780，锚点放在头中心 0.377，便于和头对齐 + 头原地缩放）
    const bodyN = new Node('body'); bodyN.layer = this.node.layer; bodyN.parent = hit;
    bodyN.addComponent(UITransform).setAnchorPoint(0.5, 0.377);
    const bodySp = bodyN.addComponent(Sprite); bodySp.sizeMode = Sprite.SizeMode.CUSTOM;
    bodyN.getComponent(UITransform)!.setContentSize(600, 780);
    bodyN.setPosition(0, this.childY, 0);

    // 头（同尺寸同锚点，叠在身子上）
    const headN = new Node('head'); headN.layer = this.node.layer; headN.parent = hit;
    headN.addComponent(UITransform).setAnchorPoint(0.5, 0.377);
    const headSp = headN.addComponent(Sprite); headSp.sizeMode = Sprite.SizeMode.CUSTOM;
    headN.getComponent(UITransform)!.setContentSize(600, 780);
    headN.setPosition(0, this.childY + hdy, 0);

    const inst: SoldierInst = {
      hit, bodySp, headSp, headNode: headN,
      body0: null, body1: null, nhead: null, phead: null,
      baseX, baseY, phase, pokeUntil: 0,
    };
    this.list.push(inst);
    const ld = (suffix: string, set: (sf: SpriteFrame) => void) =>
      resources.load(`${prefix}-${suffix}/spriteFrame`, SpriteFrame, (e, sf) => { if (!e) set(sf); });
    ld('body0', sf => { inst.body0 = sf; if (!bodySp.spriteFrame) bodySp.spriteFrame = sf; });
    ld('body1', sf => { inst.body1 = sf; });
    ld('nhead', sf => { inst.nhead = sf; headSp.spriteFrame = sf; });
    ld('phead', sf => { inst.phead = sf; });
    hit.on(Node.EventType.TOUCH_END, () => { inst.pokeUntil = this.t + this.pokeDur; }, this);
  }

  update(dt: number) {
    this.t += dt;
    for (const s of this.list) {
      const tt = this.t + s.phase;
      // 身子两帧走路
      const frame = Math.floor(tt * this.walkFps) % 2 === 0 ? s.body0 : s.body1;
      if (frame) s.bodySp.spriteFrame = frame;
      // 巡逻 + 小跳
      const x = s.baseX + Math.sin(tt * 0.8) * this.sway;
      const y = s.baseY + Math.abs(Math.sin(tt * this.walkFps * Math.PI / 2)) * 4;
      s.hit.setPosition(x, y, 0);
      // 头：凸眼时换大头 + 原地放大
      const poking = this.t < s.pokeUntil;
      if (poking && s.phead) {
        if (s.headSp.spriteFrame !== s.phead) s.headSp.spriteFrame = s.phead;
        const el = this.pokeDur - (s.pokeUntil - this.t);
        const pop = this.headPop * (1 + 0.1 * Math.max(0, 1 - el / 0.1));
        s.headNode.setScale(pop, pop, 1);
      } else {
        if (s.nhead && s.headSp.spriteFrame !== s.nhead) s.headSp.spriteFrame = s.nhead;
        s.headNode.setScale(1, 1, 1);
      }
    }
  }
}
