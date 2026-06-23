import { _decorator, Component, Node, Sprite, SpriteFrame, resources, view, UITransform } from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

interface SoldierInst {
  hit: Node;            // 点击容器
  shadow: Node;         // 地面影子
  shScale: number;      // 影子基准大小
  bodySp: Sprite;       // 无头身子
  headSp: Sprite;       // 头（正常/凸眼）
  walkFrames: (SpriteFrame | null)[];   // 步兵/骑兵都用 4 帧（body0..3 / w0..3）
  nhead: SpriteFrame | null;
  pokeFrames: (SpriteFrame | null)[];   // 点击爆头序列 poke0..3（鼓胀递减）
  headNode: Node;
  baseX: number;
  baseY: number;
  phase: number;
  pokeUntil: number;
  isCavalry: boolean;   // 是否用 4 帧马腿
  hdx: number;          // 头静态 X 偏移
  hdy: number;          // 头静态 Y 偏移
  headBobAmp: number;   // 头额外颠幅
  headBobSpeed: number; // 头颠速度倍数
}

// 城外脸谱兵：无头身子(两帧走路) + 头(叠在上面)。点击 → 头换凸眼大头并放大，盖住身子。
@ccclass('Soldiers')
export class Soldiers extends Component {
  @property
  soldierScale = 0.13;   // 整体大小（0.1→0.13 放大 30%）
  @property
  groundFy = 0.78;       // 兵所在高度（容器中心）
  @property
  childY = 0;            // 身子/头图相对容器的上下微调
  @property
  sway = 24;
  @property
  walkFps = 3;
  @property
  pokeDur = 0.15;   // 点击放大持续时间（秒），越小越快闪过
  @property
  headPop = 1.5;         // 点击时头放大倍数（1.5 = 1.5 倍）
  @property
  headDy = 300;          // 头相对身子的上下偏移（正=往上；单位大，屏幕约 ×0.1）
  @property
  shadowScale = 0.6;     // 影子大小
  @property
  shadowDy = -42;        // 影子相对兵脚的上下偏移（负=往下贴地）

  private list: SoldierInst[] = [];
  private t = 0;

  onLoad() {
    const W = DESIGN_W, H = DESIGN_H;
    const baseY = (0.5 - this.groundFy) * H;
    // [图前缀, 横向 fx, 节奏相位, 头Y偏移, 头X偏移, 身子放大, 头颠幅, 头颠倍速]
    // 第 4 = 头 Y（正=上）
    // 第 5 = 头 X（正=右）
    // 第 6 = 身子+马放大倍数
    // 第 7 = 头额外颠簸幅度（0 = 不额外颠；想头快加 20/40/60）
    // 第 8 = 头颠速度倍数（1 = 同步身子；2/3 = 头比身子快）
    const defs: [string, number, number, number, number, number, number, number][] = [
      ['soldier-black', 0.28, 0,   305, 0,   1.0, 0,  1],   // 黑脸不额外颠
      ['soldier-white', 0.50, 1.5, 450, -50, 1.3, 0,  1],   // 白脸不额外颠
      ['soldier-red',   0.72, 3.0, 470, 150, 1.0, 0,  1],
    ];
    defs.forEach(([prefix, fx, phase, hdy, hdx, bs, hba, hbs]) =>
      this.build(prefix, (fx - 0.5) * W, baseY, phase, hdy, hdx, bs, hba, hbs));
  }

  private build(prefix: string, baseX: number, baseY: number, phase: number, hdy: number, hdx: number = 0, bodyScale: number = 1, headBobAmp: number = 0, headBobSpeed: number = 1) {
    // 地面影子（先建 = 在兵后面，留在地面）
    const shadow = new Node(prefix + '-shadow'); shadow.layer = this.node.layer; shadow.parent = this.node;
    const shSp = shadow.addComponent(Sprite); shSp.sizeMode = Sprite.SizeMode.TRIMMED;
    const shScale = this.shadowScale * bodyScale;
    shadow.setScale(shScale, shScale * 0.45, 1);
    shadow.setPosition(baseX, baseY + this.shadowDy, 0);
    resources.load('shadow/spriteFrame', SpriteFrame, (e, sf) => { if (!e) shSp.spriteFrame = sf; });

    // 点击容器（足够大覆盖整个角色含头部，因为头偏移可达 +500）
    const hit = new Node(prefix); hit.layer = this.node.layer; hit.parent = this.node;
    const hui = hit.addComponent(UITransform); hui.setAnchorPoint(0.5, 0.5); hui.setContentSize(600, 1400);
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
    headN.setPosition(hdx, this.childY + hdy, 0);

    const isCavalry = prefix === 'soldier-white';   // 白脸是骑兵，有 4 帧马腿
    // 身子+马的放大（不影响头）—— 数值在上面 defs 数组的第 6 列配置
    if (bodyScale !== 1) bodyN.setScale(bodyScale, bodyScale, 1);
    // 白脸头本身偏长（原 H5 faceH=1.18），Y 压扁让脸更圆
    if (isCavalry) headN.setScale(1, 0.75, 1);
    const inst: SoldierInst = {
      hit, shadow, shScale, bodySp, headSp, headNode: headN,
      walkFrames: [null, null, null, null],
      nhead: null, pokeFrames: [null, null, null, null],
      baseX, baseY, phase, pokeUntil: 0, isCavalry,
      hdx, hdy, headBobAmp, headBobSpeed,
    };
    this.list.push(inst);
    const ld = (suffix: string, set: (sf: SpriteFrame) => void) =>
      resources.load(`${prefix}-${suffix}/spriteFrame`, SpriteFrame, (e, sf) => { if (!e) set(sf); });
    if (isCavalry) {
      // 骑兵：加载 w0-w3 四帧马腿
      ['w0','w1','w2','w3'].forEach((nm, i) => {
        ld(nm, sf => { inst.walkFrames[i] = sf; if (!bodySp.spriteFrame) bodySp.spriteFrame = sf; });
      });
    } else {
      // 步兵：加载 body0-body3 四帧走路（顺滑）
      ['body0','body1','body2','body3'].forEach((nm, i) => {
        ld(nm, sf => { inst.walkFrames[i] = sf; if (!bodySp.spriteFrame) bodySp.spriteFrame = sf; });
      });
    }
    ld('nhead', sf => { inst.nhead = sf; if (!headSp.spriteFrame) headSp.spriteFrame = sf; });
    // 点击爆头序列 poke0..3（鼓胀最大 → 逐级收回）
    ['poke0','poke1','poke2','poke3'].forEach((nm, i) => {
      ld(nm, sf => { inst.pokeFrames[i] = sf; });
    });
    hit.on(Node.EventType.TOUCH_END, () => { inst.pokeUntil = this.t + this.pokeDur; }, this);
  }

  update(dt: number) {
    this.t += dt;
    for (const s of this.list) {
      const tt = this.t + s.phase;
      // 身子动画：都用 4 帧循环（骑兵马腿速度 ×2）
      const fps = s.isCavalry ? this.walkFps * 2 : this.walkFps;
      const idx = Math.floor(tt * fps) % 4;
      const frame = s.walkFrames[idx];
      if (frame) s.bodySp.spriteFrame = frame;
      // 巡逻 + 小跳（骑兵跳更高，步兵也跳但小；整个 hit 容器跳，头自动跟着）
      const x = s.baseX + Math.sin(tt * 0.8) * this.sway;
      const bounceAmp = s.isCavalry ? 8 : 12;    // 白脸跳低（8）
      const bounceFreq = s.isCavalry ? this.walkFps : this.walkFps;   // 白脸跳慢（×1）
      const bounceN = Math.abs(Math.sin(tt * bounceFreq * Math.PI / 2));   // 0→1 跳起程度
      const y = s.baseY + bounceN * bounceAmp;
      s.hit.setPosition(x, y, 0);
      // 影子：留在地面跟随水平，跳得越高影子越小
      const ss = s.shScale * (1 - bounceN * 0.4);
      s.shadow.setScale(ss, s.shScale * 0.45, 1);
      s.shadow.setPosition(x, s.baseY + this.shadowDy, 0);
      // 头位置 = 静态偏移 + 额外颠（STEP 函数，跟身子帧切换瞬间同步，不再用 sin）
      let extraBob = 0;
      if (s.headBobAmp > 0) {
        // 用跟身子帧切换完全相同的整数计数器 → 头 Y 在帧切换瞬间跳动 → 完美同步
        const fps2 = (s.isCavalry ? this.walkFps * 2 : this.walkFps) * s.headBobSpeed;
        const frameIdx = Math.floor(tt * fps2) % 4;
        extraBob = (frameIdx === 1 || frameIdx === 3) ? s.headBobAmp : 0;
      }
      // 身子向上的瞬间，头也跟着向上（+extraBob 而非 -）
      s.headNode.setPosition(s.hdx, this.childY + s.hdy + extraBob, 0);

      // 头：点击时按序播放爆头帧 poke0→poke3→正常头（眼球逐渐爆出再收回，大小烤进帧里）
      s.headNode.setScale(1, 1, 1);
      const remain = s.pokeUntil - this.t;
      if (remain > 0 && s.pokeFrames[0]) {
        const e = 1 - remain / this.pokeDur;          // 0→1 已过比例
        const idx = Math.min(4, Math.floor(e * 5));   // 0..3=爆头帧, 4=回正常头
        const f = idx < 4 ? s.pokeFrames[idx] : s.nhead;
        if (f && s.headSp.spriteFrame !== f) s.headSp.spriteFrame = f;
      } else {
        if (s.nhead && s.headSp.spriteFrame !== s.nhead) s.headSp.spriteFrame = s.nhead;
      }
    }
  }
}
