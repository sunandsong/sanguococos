import { Node, Sprite, SpriteFrame, UITransform, Layers, Color } from 'cc';
import { AssetHub } from './AssetHub';
import { HeroRig } from './HeroRig';

// ─────────────────────────────────────────────────────────────
// 战斗表现套件：三段连招状态 + 挥砍刀气弧 + 剑气波。可复用于任意横版场景。
//   本模块管：连招计时、刀气弧(新月随挥砍旋转)、剑气波(新月飞行淡出)、起手音效。
//   场景管：角色物理、跳劈起跳/落地(自行调 HeroRig.slamImpactFx)、限制(水下不可等)。
//   坐标：全用「角色所在节点」的本地(屏幕)坐标；剑气波在屏幕空间飞。
//   跳劈落地的冲击波/闪电在 HeroRig 里(updateFx),此处不重复。
// ─────────────────────────────────────────────────────────────
export class HeroCombat {
  atkType = 0; atkTimer = 0; atkDur = 0.42; comboT = 0; specialCd = 0;
  scale = 1;   // 特效整体缩放(角色被场景缩小时同步,如竞技场)
  readonly ATK_DUR = 0.42; readonly COMBO_WINDOW = 0.5; readonly SPECIAL_CD = 1.0;

  private hero: HeroRig;
  private fxLayer: Node;
  private fxCre: SpriteFrame | null = null;
  private slashN: Node; private slashSp: Sprite;
  private wavePool: { n: Node; sp: Sprite }[] = [];
  private waves: { x: number; y: number; dir: number; life: number; max: number }[] = [];

  constructor(fxLayer: Node, hero: HeroRig) {
    this.fxLayer = fxLayer; this.hero = hero;
    this.slashN = new Node('hc-slash'); this.slashN.layer = Layers.Enum.UI_2D; this.slashN.parent = fxLayer;
    this.slashN.addComponent(UITransform).setContentSize(128, 128);
    this.slashSp = this.slashN.addComponent(Sprite); this.slashSp.sizeMode = Sprite.SizeMode.CUSTOM; this.slashN.active = false;
    AssetHub.loadSF('fx-crescent', (sf) => { if (!sf) return; this.fxCre = sf; this.slashSp.spriteFrame = sf; });
  }

  /** 起手一刀。返回招式(0下劈/1上挑/2跳劈);-1=还在挥、不能接 */
  tryAttack(): number {
    if (this.atkTimer > this.atkDur * 0.45) return -1;
    this.atkType = this.comboT > 0 ? (this.atkType + 1) % 3 : 0;
    const dur = this.atkType === 2 ? this.ATK_DUR * 1.5 : this.ATK_DUR;
    this.atkTimer = dur; this.atkDur = dur; this.comboT = dur + this.COMBO_WINDOW;
    this.hero.sndSwing(this.atkType);
    return this.atkType;
  }

  /** 放剑气波(sx/sy=胸口屏幕坐标,dir 朝向)。cd 未好返回 false */
  trySpecial(dir: number, sx: number, sy: number): boolean {
    if (this.specialCd > 0) return false;
    this.specialCd = this.SPECIAL_CD;
    this.waves.push({ x: sx, y: sy, dir, life: 0, max: 1.25 });
    if (this.atkTimer <= 0) { this.atkType = 0; this.atkDur = this.ATK_DUR; this.atkTimer = this.ATK_DUR; }  // 顺带摆挥砍姿势
    return true;
  }

  /** 当前该摆的攻击姿势(给场景选 HeroRig mode);无=null */
  anim(): { mode: 'attack' | 'slam'; p: number } | null {
    if (this.atkTimer <= 0) return null;
    return { mode: this.atkType === 2 ? 'slam' : 'attack', p: 1 - this.atkTimer / this.atkDur };
  }

  private waveFx(i: number): { n: Node; sp: Sprite } | null {
    if (this.wavePool[i]) return this.wavePool[i];
    if (!this.fxCre || i >= 4) return null;
    const n = new Node('hc-wave' + i); n.layer = Layers.Enum.UI_2D; n.parent = this.fxLayer;
    n.addComponent(UITransform).setContentSize(128, 128);
    const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = this.fxCre;
    const rec = { n, sp }; this.wavePool.push(rec); return rec;
  }

  /** 每帧:heroSX/heroSY=角色脚底屏幕坐标,dir 朝向 */
  update(dt: number, heroSX: number, heroSY: number, dir: number) {
    if (this.specialCd > 0) this.specialCd -= dt;
    if (this.comboT > 0) this.comboT -= dt;
    if (this.atkTimer > 0) this.atkTimer -= dt;

    // 挥砍刀气弧(新月随挥砍进度旋转,中段最亮)
    let slashOn = false;
    if (this.atkTimer > 0 && this.slashSp.spriteFrame) {
      const s = 1 - this.atkTimer / this.atkDur, a = 1 - Math.abs(s - 0.4) / 0.6;
      if (a > 0.05) {
        const cx = heroSX + dir * 55 * this.scale, cy = heroSY + 74 * this.scale;   // 刀气加大后再前推
        const c0 = dir > 0 ? 0 : Math.PI;
        const vert = this.atkType === 1 ? 0.9 - 1.9 * s : this.atkType === 2 ? 0.15 + 0.5 * s : -0.9 + 1.9 * s;
        this.slashN.active = true;
        this.slashN.setPosition(cx, cy, 0);
        this.slashN.angle = (c0 - dir * vert) * 57.29578;
        const ss = 2.55 * this.scale;
        this.slashN.setScale(ss, ss, 1);   // 刀气=原始1.5倍(紫焰新月)×场景缩放
        this.slashSp.color = new Color(255, 255, 255, Math.round(230 * a));   // 纯白不染色,保紫焰本色
        slashOn = true;
      }
    }
    if (!slashOn && this.slashN.active) this.slashN.active = false;

    // 剑气波:屏幕空间飞行 + 淡出
    const speed = 900;
    for (let i = this.waves.length - 1; i >= 0; i--) { const w = this.waves[i]; w.life += dt; w.x += w.dir * speed * dt; if (w.life >= w.max) this.waves.splice(i, 1); }
    let wi = 0;
    for (const w of this.waves) {
      const fx = this.waveFx(wi); if (!fx) break; wi++;
      const a = Math.max(0, 1 - w.life / w.max);
      fx.n.active = true; fx.n.setPosition(w.x, w.y, 0);
      fx.n.angle = w.dir > 0 ? 0 : 180; fx.n.setScale(0.95 * this.scale, 0.95 * this.scale, 1);
      fx.sp.color = new Color(150, 235, 255, Math.round(240 * a));   // 青白剑气
    }
    for (; wi < this.wavePool.length; wi++) this.wavePool[wi].n.active = false;
  }

  reset() { this.atkType = 0; this.atkTimer = 0; this.comboT = 0; this.specialCd = 0; this.waves.length = 0; }
}
