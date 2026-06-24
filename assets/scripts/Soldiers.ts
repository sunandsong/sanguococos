import { _decorator, Component, Node, Sprite, SpriteFrame, resources, view, UITransform, Label, LabelOutline, UIOpacity, Color } from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
import { GameState } from './GameState';
const { ccclass, property } = _decorator;

interface SoldierInst {
  hit: Node;            // 点击容器
  shadow: Node;         // 地面影子
  shScale: number;      // 影子基准大小
  bodySp: Sprite;       // 无头身子
  headSp: Sprite;       // 头（正常/凸眼）
  smileCover: Node | null;  // 白脸夜里盖住笑容的小贴片
  walkFrames: (SpriteFrame | null)[];   // 步兵/骑兵都用 4 帧（body0..3 / w0..3）
  nhead: SpriteFrame | null;
  nheadNight: SpriteFrame | null;   // 白脸夜里无表情头（仅白脸有）
  pokeFrames: (SpriteFrame | null)[];   // 点击爆头序列 poke0..3（鼓胀递减）
  sleepFrames: (SpriteFrame | null)[];  // 渐渐闭眼序列 sleep0..3，白脸为空
  sleepBody: SpriteFrame | null;        // 睡觉站立身子（双腿落地），白脸为空
  sleeps: boolean;                      // 夜里是否睡觉（黑/红=true，白=false）
  sleepT: number;                       // 0=醒，1=睡熟（渐变）
  zzz: Node | null;                     // 飘 Zzz 的文字
  zzzOp: UIOpacity | null;
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
  pokeDur = 0.28;   // 点击爆头持续时间（秒），越大越慢
  @property
  headPop = 1.5;         // 点击时头放大倍数（1.5 = 1.5 倍）
  // 白脸夜里去笑容：在脸上贴一个小肉色矩形盖住嘴弧线
  @property whiteSmileCoverX = 0;      // 笑容覆盖 X（脸的横向中心）
  @property whiteSmileCoverY = -60;    // 笑容覆盖 Y
  @property whiteSmileCoverW = 170;    // 覆盖宽（再大一单）
  @property whiteSmileCoverH = 75;     // 覆盖高
  @property whiteSmileDebug = false;   // ⚙️ 调试：true=红色一直显示；false=肉色 + 只夜里显示
  @property
  pokeScale = 1.3;       // 爆头时整体再放大（在烤进帧的大小基础上 ×，越大越夸张）
  @property
  sleepFadeDur = 2.5;    // 渐渐睡着/醒来的过渡时长（秒）
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
    // 白脸：加一个肉色小贴片用来夜里盖住嘴笑（默认隐身，update 里根据 isNight 切显隐）
    let smileCover: Node | null = null;
    if (isCavalry) {
      smileCover = new Node('smileCover'); smileCover.layer = this.node.layer; smileCover.parent = headN;
      const sui = smileCover.addComponent(UITransform);
      sui.setAnchorPoint(0.5, 0.5);
      sui.setContentSize(this.whiteSmileCoverW, this.whiteSmileCoverH);
      const ssp = smileCover.addComponent(Sprite);
      ssp.sizeMode = Sprite.SizeMode.CUSTOM;
      ssp.color = new Color(245, 230, 200, 255);   // 肉色（融入脸色）
      resources.load('white/spriteFrame', SpriteFrame, (e, sf) => { if (!e) ssp.spriteFrame = sf; });
      smileCover.setPosition(this.whiteSmileCoverX, this.whiteSmileCoverY, 0);
      smileCover.active = this.whiteSmileDebug;     // 调试时一直显示
    }
    const sleeps = !isCavalry;   // 黑/红夜里睡觉，白脸继续巡逻
    // 睡觉时飘的 Zzz（只给会睡的兵建）
    let zzz: Node | null = null, zzzOp: UIOpacity | null = null;
    if (sleeps) {
      zzz = new Node('zzz'); zzz.layer = this.node.layer; zzz.parent = hit;
      zzz.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
      const zsp = zzz.addComponent(Sprite); zsp.sizeMode = Sprite.SizeMode.TRIMMED;
      resources.load('zzz/spriteFrame', SpriteFrame, (e, sf) => { if (!e) zsp.spriteFrame = sf; });
      zzzOp = zzz.addComponent(UIOpacity); zzzOp.opacity = 0;
      zzz.setScale(1.15, 1.15, 1);
      zzz.setPosition(300, this.childY + hdy + 420, 0);          // 靠右上
    }
    const inst: SoldierInst = {
      hit, shadow, shScale, bodySp, headSp, smileCover, headNode: headN,
      walkFrames: [null, null, null, null],
      nhead: null, nheadNight: null, pokeFrames: [null, null, null, null],
      sleepFrames: [null, null, null, null], sleepBody: null, sleeps, sleepT: 0, zzz, zzzOp,
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
    // 白脸专属：夜里无表情头
    if (isCavalry) ld('nhead-night', sf => { inst.nheadNight = sf; });
    // 点击爆头序列 poke0..3（鼓胀最大 → 逐级收回）
    ['poke0','poke1','poke2','poke3'].forEach((nm, i) => {
      ld(nm, sf => { inst.pokeFrames[i] = sf; });
    });
    if (sleeps) {
      ['sleep0','sleep1','sleep2','sleep3'].forEach((nm, i) => {
        ld(nm, sf => { inst.sleepFrames[i] = sf; });
      });
      ld('sleepbody', sf => { inst.sleepBody = sf; });
    }
    hit.on(Node.EventType.TOUCH_END, () => { inst.pokeUntil = this.t + this.pokeDur; }, this);
  }

  update(dt: number) {
    this.t += dt;
    const night = GameState.i.sunVis < 0.35;   // 太阳基本落下 = 夜
    for (const s of this.list) {
      // 白脸夜里：换无表情头（nhead → nhead-night）— 仅在非戳头时
      if (s.isCavalry && s.nheadNight && s.nhead && !poking) {
        const target = night ? s.nheadNight : s.nhead;
        if (s.headSp.spriteFrame !== target) s.headSp.spriteFrame = target;
      }
      // 旧的肉色贴片关掉（不再用）
      if (s.smileCover) s.smileCover.active = false;
      const tt = this.t + s.phase;
      // 夜里睡觉（黑/红）：站定后眼睛渐渐闭上，睡熟才飘 Zzz
      const poking = this.t < s.pokeUntil;
      // sleepT 渐变：想睡→升，白天→降；被戳时暂停（保持状态，戳完继续）
      if (!poking) {
        const wantSleep = night && s.sleeps;
        s.sleepT = Math.max(0, Math.min(1, s.sleepT + (wantSleep ? 1 : -1) * dt / this.sleepFadeDur));
      }
      // Zzz 只在睡熟（sleepT≈1）后出现并上飘；被戳时不飘
      if (s.zzz && s.zzzOp) {
        if (s.sleepT >= 0.95 && !poking) {
          const zc = (this.t * 0.6 + s.phase) % 1;     // 0→1 循环上飘
          // 明显一点：淡入淡出，峰值接近全显
          const a = 0.35 + 0.6 * Math.max(0, Math.sin(zc * Math.PI));
          s.zzzOp.opacity = Math.round(a * 255);
          s.zzz.setPosition(300, this.childY + s.hdy + 420 + zc * 140, 0);   // 靠右
        } else {
          s.zzzOp.opacity = 0;
        }
      }
      // 一旦开始犯困（sleepT>0）就站定不走，眼睛按 sleepT 渐渐闭上
      if (s.sleepT > 0) {
        const standBody = s.sleepBody || s.walkFrames[0];              // 双腿落地的站立身子
        if (standBody) s.bodySp.spriteFrame = standBody;
        s.hit.setPosition(s.baseX, s.baseY, 0);                        // 不走动
        s.shadow.setScale(s.shScale, s.shScale * 0.45, 1);
        s.shadow.setPosition(s.baseX, s.baseY + this.shadowDy, 0);
        s.headNode.setPosition(s.hdx, this.childY + s.hdy, 0);
        if (poking) {
          this.pokeHead(s);   // 睡着被戳：头爆大（身子是睡着站着，不是被冻结）
        } else {
          s.headNode.setScale(1, 1, 1);
          // sleepT 0→1 映射：睁眼(nhead) → sleep0..3(渐闭)，共 5 档
          const si = Math.min(4, Math.floor(s.sleepT * 5));   // 0..4
          const f = si === 0 ? s.nhead : s.sleepFrames[si - 1];
          if (f && s.headSp.spriteFrame !== f) s.headSp.spriteFrame = f;
        }
        continue;
      }
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

      // 头：被戳→爆头帧（身子照常走）；否则正常头
      if (poking) {
        this.pokeHead(s);
      } else {
        s.headNode.setScale(1, 1, 1);
        // 白脸夜里用无表情头，白天用 nhead；其他兵种始终 nhead
        const target = (night && s.isCavalry && s.nheadNight) ? s.nheadNight : s.nhead;
        if (target && s.headSp.spriteFrame !== target) s.headSp.spriteFrame = target;
      }
    }
  }

  // 点击爆头：只换头帧 + 放大，不动身子。poke0→poke3 鼓胀递减，最后收回
  private pokeHead(s: SoldierInst) {
    const remain = s.pokeUntil - this.t;
    const e = 1 - remain / this.pokeDur;             // 0→1 已过比例
    const pi = Math.min(4, Math.floor(e * 5));       // 0..3=爆头帧, 4=收回
    const back = s.sleepT > 0 ? (s.sleepFrames[3] || s.nhead) : s.nhead;   // 睡着收回到闭眼
    const f = pi < 4 ? s.pokeFrames[pi] : back;
    if (f && s.headSp.spriteFrame !== f) s.headSp.spriteFrame = f;
    const k = pi < 4 ? this.pokeScale : 1;
    s.headNode.setScale(k, k, 1);
  }
}
