import { Node, Sprite, SpriteFrame, UITransform, Texture2D, Rect, Layers, Graphics, Color } from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
import { AssetHub } from './AssetHub';
import { AudioMgr } from './AudioMgr';
import { JUMP } from './JumpKit';

// ─────────────────────────────────────────────────────────────
// 步战赵云「角色套件」：从第一章 BattleScene 抽出来的可复用可视模块。
//   走路 / 待机 / 空中(跳跃) / 攻击(横斩) / 跳劈 —— 帧尺寸/锚点/缩放/朝向全部对齐第一章。
//   约定：默认精灵朝左，dir>=0(朝右) 时水平翻转；整体 ×1.8。
// ─────────────────────────────────────────────────────────────
export type HeroMode = 'idle' | 'walk' | 'air' | 'attack' | 'slam' | 'slide' | 'swim' | 'swimH' | 'float' | 'dead';

export class HeroRig {
  readonly node: Node;
  private sp: Sprite;
  private ut: UITransform;
  private foot: SpriteFrame[] = [];   // 走路/待机 4 帧 40×44
  private jump: SpriteFrame[] = [];   // 跳跃 3 帧 64×56（0蹲 1伸展 2屈腿）
  private atk: SpriteFrame[] = [];    // 横斩 4 帧 64×56
  private slam: SpriteFrame[] = [];   // 跳劈 4 帧 72×72
  private slideF: SpriteFrame[] = []; // 滑铲 3 帧(入蹲→低滑→起身)
  private swim: SpriteFrame[] = [];   // 竖游 3 帧 40×72(收腿→蹬腿→滑行,竖直向上)
  private swimH: SpriteFrame[] = [];  // 横游 3 帧 72×40(收腿→蹬腿→滑行,头朝左)
  private float: SpriteFrame[] = [];  // 水面踩水 2 帧 56×56(双臂开合)
  private readonly HERO_ROW = 1;
  private readonly S = 1.8;           // 与第一章 SPRITE_SCALE 一致
  jumpRefVy = JUMP.VY;                // 跳跃初速参考(空中挤压拉伸的归一化基准);非屏幕像素坐标系的场景要除以自己的 SCALE
  ambient: Color | null = null;       // 场景环境光染色(井=湿冷青/洞=暖火光,不设=纯白):角色揉进场景色,压"贴纸感"
  private landT = 0;                  // 落地回弹计时(空中→落地时由套件自己触发,压扁→过冲→归位)
  private hurtT = 0;                  // 挨揍表现计时(后仰42°+红闪,0.3s回正,对齐第一章)
  private wasAir = false;             // 上一帧是否腾空(检测起跳/落地瞬间)
  private airJump = false;            // 本次腾空是"跳起来的"(走下台边的下坠不放大,与第一章一致)
  private readonly LAND_DUR = 0.3;    // 落地缓冲时长(与第一章 JUMP_LAND 同参)
  ready = false;

  // ── 跳劈落地特效(套件自带):贴地冲击波序列帧 + 天降闪电,参数与第一章一致 ──
  private fxSlamN: Node | null = null; private fxSlamSp: Sprite | null = null; private fxSlamFrames: SpriteFrame[] = [];
  private boltG: Graphics | null = null;
  private slamFxT = 0; private readonly SLAM_FX_DUR = 0.34;
  private dimG: Graphics | null = null; private slamDimT = 0;   // 大招落地全屏压黑一闪(衬爆发)
  private bolt: number[][] = [];      // 相对冲击点的偏移折线
  private boltT = 0; private fxX = 0; private fxY = 0; private fxClock = 0;

  private shadowG: Graphics | null = null;

  constructor(parent: Node, fxParent?: Node) {
    // 接地影(先建=画在角色底下):场景在 apply 里传地面 y 就显示,腾空越高影子越小
    const shN = new Node('rig-shadow'); shN.layer = Layers.Enum.UI_2D; shN.parent = parent;
    shN.addComponent(UITransform);
    this.shadowG = shN.addComponent(Graphics);
    this.node = new Node('hero-rig'); this.node.layer = Layers.Enum.UI_2D; this.node.parent = parent;
    this.ut = this.node.addComponent(UITransform); this.ut.setContentSize(40, 44); this.ut.setAnchorPoint(0.5, 0);
    this.sp = this.node.addComponent(Sprite); this.sp.sizeMode = Sprite.SizeMode.CUSTOM;
    // 跳劈特效节点(冲击波精灵 + 闪电画布),挂在特效层(默认与角色同层)
    const fxP = fxParent ?? parent;
    this.fxSlamN = new Node('rig-slamfx'); this.fxSlamN.layer = Layers.Enum.UI_2D; this.fxSlamN.parent = fxP;
    const su = this.fxSlamN.addComponent(UITransform); su.setContentSize(160, 136); su.setAnchorPoint(0.5, 0.34);   // 锚点0.34=地面线
    this.fxSlamSp = this.fxSlamN.addComponent(Sprite); this.fxSlamSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.fxSlamN.active = false;
    const bn = new Node('rig-slambolt'); bn.layer = Layers.Enum.UI_2D; bn.parent = fxP;
    bn.addComponent(UITransform);
    this.boltG = bn.addComponent(Graphics);
    // 大招压黑罩(全屏,平时空)
    const dn = new Node('rig-slamdim'); dn.layer = Layers.Enum.UI_2D; dn.parent = fxP;
    dn.addComponent(UITransform);
    this.dimG = dn.addComponent(Graphics);
    this.load();
  }

  private each(name: string, cb: (tex: Texture2D) => void) {
    AssetHub.loadSF(name, (base) => {
      if (!base) return;
      const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      cb(tex);
    });
  }
  private load() {
    // 新主角四套帧:贴图是显示尺寸的2倍(高清防糊),显示 contentSize 不变;平滑卡通风用 LINEAR 采样
    this.each('zhaoyun-foot', (tex) => {
      tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 160, 0, 160, 112); this.foot.push(sf); }
      if (!this.sp.spriteFrame) this.sp.spriteFrame = this.foot[0];
      this.ready = true;
    });
    this.each('zhaoyun-jump', (tex) => { tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR); for (let c = 0; c < 3; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 160, 0, 160, 112); this.jump.push(sf); } });
    this.each('zhaoyun-attack', (tex) => { tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR); for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 192, 0, 192, 112); this.atk.push(sf); } });
    this.each('zhaoyun-slam', (tex) => { tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR); for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 192, 0, 192, 160); this.slam.push(sf); } });
    this.each('zhaoyun-slide', (tex) => { tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR); for (let c = 0; c < 3; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 192, 0, 192, 112); this.slideF.push(sf); } });
    this.each('fx-slam-impact', (tex) => { tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR); for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 320, 0, 320, 272); this.fxSlamFrames.push(sf); } });   // 紫爆2×高清
    this.each('zhaoyun-swim', (tex) => { tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR); for (let c = 0; c < 3; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 88, 0, 88, 92); this.swim.push(sf); } });   // 新主角:2×高清(竖直版)
    this.each('zhaoyun-swim-h', (tex) => { tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR); for (let c = 0; c < 3; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 136, 0, 136, 96); this.swimH.push(sf); } });   // 新主角:2×高清
    this.each('zhaoyun-float', (tex) => { tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR); for (let c = 0; c < 2; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 104, 0, 104, 92); this.float.push(sf); } });   // 新主角:2×高清
  }

  hasAttack() { return this.atk.length >= 4; }

  /** 攻击起手音效(与第一章一致):type 2=跳劈 swing2,其余=平斩 swing */
  sndSwing(type: number) { AudioMgr.inst.play(type === 2 ? 'swing2' : 'swing', 0.9); }

  /** 挨揍表现(套件统一,对齐第一章):身体后仰42°随0.3s回正 + 红闪。音效/喷血/击退仍由场景管 */
  hurtFx() { this.hurtT = 0.3; }

  /** 跳劈落地特效(屏幕坐标触发):x/y=冲击点,topY=闪电起点高度(一般传画面顶);自带落地闷响 */
  slamImpactFx(x: number, y: number, topY: number) {
    AudioMgr.inst.play('land', 0.7);
    this.slamFxT = this.SLAM_FX_DUR; this.fxX = x; this.fxY = y;
    const steps = 9, sx = (Math.random() - 0.5) * 140, top = topY - y;
    const pts: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push([sx * (1 - t) + (i > 0 && i < steps ? (Math.random() - 0.5) * 52 : 0), top * (1 - t)]);
    }
    pts[steps] = [0, 0];   // 末端钉在冲击点
    this.bolt = pts; this.boltT = 0.26;
    this.slamDimT = 0.5;   // 全屏压黑一闪,衬紫爆
  }

  /** 每帧推进跳劈特效;镜头会动的场景把冲击点的最新屏幕坐标传进来(不传则用触发时坐标) */
  updateFx(dt: number, x?: number, y?: number) {
    this.fxClock += dt;
    if (this.landT > 0) this.landT -= dt;   // 落地回弹计时(视觉专用,不影响物理)
    if (this.hurtT > 0) this.hurtT -= dt;   // 挨揍后仰/红闪回正
    // 大招落地全屏压黑一闪(快速淡出;脏标记:只在激活期间重画,平时零开销)
    if (this.dimG && this.slamDimT > 0) {
      this.slamDimT -= dt;
      this.dimG.clear();
      if (this.slamDimT > 0) {
        const da = Math.round(110 * Math.max(0, Math.min(1, this.slamDimT / 0.5)));
        this.dimG.fillColor = new Color(8, 4, 16, da);
        this.dimG.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H); this.dimG.fill();
      }
    }
    if (x !== undefined) this.fxX = x;
    if (y !== undefined) this.fxY = y;
    // 冲击波:计时选帧,横宽纵扁贴地
    if (this.fxSlamN && this.fxSlamSp) {
      if (this.slamFxT <= 0 || this.fxSlamFrames.length < 4) {
        if (this.fxSlamN.active) this.fxSlamN.active = false;
      } else {
        this.slamFxT -= dt;
        const p = 1 - Math.max(0, this.slamFxT) / this.SLAM_FX_DUR;
        const fi = Math.min(3, Math.floor(p * 4));
        this.fxSlamN.active = true;
        this.fxSlamN.setPosition(this.fxX, this.fxY + 2, 0);
        this.fxSlamN.setScale(3.75, 1.8, 1);   // 冲击环再放大1.5倍
        this.fxSlamSp.spriteFrame = this.fxSlamFrames[fi];
        this.fxSlamSp.color = new Color(255, 255, 255, fi === 3 ? 200 : 255);
      }
    }
    // 闪电:外发光粗线+亮芯细线,快速衰减+高频抖闪
    const g = this.boltG;
    if (g) {
      g.clear();
      if (this.boltT > 0 && this.bolt.length > 1) {
        this.boltT -= dt;
        const a = Math.max(0, this.boltT / 0.26) * (0.7 + 0.3 * Math.sin(this.fxClock * 60));
        const path = () => {
          g.moveTo(this.fxX + this.bolt[0][0], this.fxY + this.bolt[0][1]);
          for (let i = 1; i < this.bolt.length; i++) g.lineTo(this.fxX + this.bolt[i][0], this.fxY + this.bolt[i][1]);
        };
        g.strokeColor = new Color(196, 132, 255, Math.round(130 * a)); g.lineWidth = 13; path(); g.stroke();   // 紫电外发光
        g.strokeColor = new Color(252, 238, 255, Math.round(248 * a)); g.lineWidth = 4; path(); g.stroke();   // 粉白亮芯
      }
    }
  }

  /** 每帧调用。x/y = 脚底 Cocos 坐标；dir +1右/-1左；p = 攻击/跳劈进度 0..1；vy 世界竖速(向下为正)；walkPhase 走路相位；tilt 抬头倾角(度,斜游用)；shadowY = 脚下地面的屏幕 y(不传=无影子) */
  apply(x: number, y: number, dir: number, mode: HeroMode, p = 0, vy = 0, walkPhase = 0, tilt = 0, shadowY?: number) {
    this.node.setPosition(x, y, 0);
    // 接地影:双层椭圆(软影+脚下浓核),离地越高越小越淡
    if (this.shadowG) {
      const g = this.shadowG; g.clear();
      if (shadowY !== undefined) {
        const hgt = Math.max(0, y - shadowY);
        const k = Math.max(0.3, 1 - hgt / 320);
        g.fillColor = new Color(0, 0, 0, Math.round(100 * k));
        g.ellipse(x, shadowY - 2, 34 * k, 9 * k); g.fill();     // 新主角胖大头:影子加宽加厚,居中脚下
        g.fillColor = new Color(0, 0, 0, Math.round(155 * k));
        g.ellipse(x, shadowY - 2, 17 * k, 4.6 * k); g.fill();
      }
    }
    this.node.setScale((dir >= 0 ? -this.S : this.S), this.S, 1);   // 默认朝左 → 朝右翻转（对齐第一章）
    this.node.angle = tilt === 0 ? 0 : (dir >= 0 ? tilt : -tilt);   // 抬头为正(斜游身体顺着运动方向倾)
    // 阵亡演出(与第一章一致):缓缓倒地(90°) + 下沉 + 灰化 + 溶解;p = 阵亡秒数
    if (mode === 'dead') {
      this.ut.setContentSize(80, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
      if (this.foot.length) this.sp.spriteFrame = this.foot[0];
      const d = p;
      this.node.angle = (dir >= 0 ? 1 : -1) * Math.min(90, d * 72);
      this.node.setPosition(x, y - Math.min(1, d / 1.3) * 25, 0);
      const v = Math.round(255 - 95 * Math.min(1, d / 1.8));                              // 渐渐灰化
      const a2 = Math.max(0, Math.round(255 * (1 - Math.max(0, d - 2.6) / 1.4)));         // 先看倒地 2.6s,再溶解
      this.sp.color = new Color(v, v, v, a2);
      return;
    }
    const tr = this.ambient ? this.ambient.r : 255, tg = this.ambient ? this.ambient.g : 255, tb = this.ambient ? this.ambient.b : 255;
    if (this.sp.color.r !== tr || this.sp.color.g !== tg || this.sp.color.b !== tb || this.sp.color.a !== 255) this.sp.color = new Color(tr, tg, tb, 255);   // 复活恢复本色+环境光
    // 挨揍中:后仰42°随时间回正 + 红闪(叠加在任何姿势上;scaleX翻转抵消,朝左朝右都是"向后倒")
    if (this.hurtT > 0) {
      const hk = this.hurtT / 0.3;
      this.node.angle += 42 * hk;
      this.sp.color = new Color(tr, Math.round(tg * (1 - 0.5 * hk)), Math.round(tb * (1 - 0.5 * hk)), 255);
    }
    const grounded = mode === 'walk' || mode === 'idle';
    const airborne = mode === 'air' || (mode === 'slam' && p < 0.9);   // 跳劈收势帧(p≥0.9)已落地:立即还原,不再按"速度0=最高点"误放大
    if (this.wasAir && grounded) this.landT = this.LAND_DUR;   // 腾空→落地瞬间:触发回弹(套件自检,场景零接线)
    if (airborne && !this.wasAir) this.airJump = -vy > this.jumpRefVy * 0.3;   // 起跳瞬间在上升=真跳;走下台边的下坠不算
    this.wasAir = airborne;
    // 跳跃随高度整体放大(从第一章提取):最高点约1.5倍,落地恢复——"跳起来人变大"的主效果。
    // 高度用速度反推 h∝1-(v/V)²:与镜头无关(井关镜头垂直跟人,用屏幕坐标算高度会恒为0),天然跨坐标系
    const ref = mode === 'slam' ? this.jumpRefVy * (JUMP.SLAM_VY / JUMP.VY) : this.jumpRefVy;
    const hNorm = Math.max(0, 1 - (vy / ref) * (vy / ref));
    const boost = airborne && this.airJump ? 1 + 0.5 * hNorm : 1;
    if (mode === 'slam' && this.slam.length >= 4) {
      this.ut.setContentSize(96, 80); this.ut.setAnchorPoint(0.5, 4 / 80);
      const idx = p <= 0.15 ? 0 : p < 0.9 ? 1 : 2;
      this.sp.spriteFrame = this.slam[idx];
      this.node.setScale((dir >= 0 ? -this.S : this.S) * boost, this.S * boost, 1);   // 跳劈腾空同样随高度放大
    } else if (mode === 'attack' && this.atk.length >= 4) {
      this.ut.setContentSize(96, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
      const idx = p < 0.32 ? 0 : p < 0.5 ? 1 : p < 0.75 ? 2 : 3;   // 预备→斩→刺→收
      this.sp.spriteFrame = this.atk[idx];
    } else if (mode === 'swim' && this.swim.length >= 3) {
      this.ut.setContentSize(44, 46); this.ut.setAnchorPoint(0.5, 0.5);   // 水下泳姿锚在身体中心:浮近水面时身体渐露,不会整个蹦到水线上
      const c = walkPhase % 3;
      this.sp.spriteFrame = this.swim[c < 0.8 ? 0 : c < 1.7 ? 1 : 2];   // 收腿短拍 → 蹬腿 → 滑行长拍
    } else if (mode === 'swimH' && this.swimH.length >= 3) {
      this.ut.setContentSize(68, 48); this.ut.setAnchorPoint(0.5, 0.5);
      const c = walkPhase % 3;
      this.sp.spriteFrame = this.swimH[c < 0.8 ? 0 : c < 1.7 ? 1 : 2];  // 横游同节奏
    } else if (mode === 'float' && this.float.length >= 2) {
      this.ut.setContentSize(52, 46); this.ut.setAnchorPoint(0.5, 0.62);   // 锚点在胸口:定位点=水面线时露出整个头+肩,身体沉在水下
      this.sp.spriteFrame = this.float[Math.floor(walkPhase) % 2];      // 踩水:双臂开合慢循环
    } else if (mode === 'slide' && this.slideF.length >= 3) {
      this.ut.setContentSize(96, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
      this.sp.spriteFrame = this.slideF[p < 0.12 ? 0 : p < 0.88 ? 1 : 2];   // 入蹲→低滑(拉长)→起身
    } else if (mode === 'air' && this.jump.length >= 3) {
      this.ut.setContentSize(80, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
      this.sp.spriteFrame = this.jump[vy < 0 ? 1 : 2];             // 上升伸展 / 下落屈腿
      // 跳跃挤压拉伸(从第一章提取):上升越快越拉长 → 顶点缩短(0.72) → 下落回正;
      // 跳跃帧姿态已画在图里,程序挤压只留 40%(与第一章同参)
      const vn = -vy / this.jumpRefVy;   // >0 上升
      const ry = vn > 0 ? 0.72 + Math.min(1, vn) * 0.68 : 0.72 + Math.min(1, -vn) * 0.28;
      const cy = Math.max(0.6, Math.min(1.45, 1 + (ry - 1) * 0.4));
      const cx = Math.max(0.7, 1 + (1 - (ry - 1) * 0.6 - 1) * 0.4);
      this.node.setScale((dir >= 0 ? -this.S : this.S) * cx * boost, this.S * cy * boost, 1);   // 拉伸×随高度放大
    } else if (this.foot.length) {
      if (this.landT > 0 && grounded && this.jump.length >= 3) {
        // 落地回弹(从第一章提取,同参):前段蹲帧压扁 → 后段弹性过冲拉高 → 归位;程序挤压只留40%
        const l = Math.max(0, this.landT) / this.LAND_DUR;   // 1→0
        this.ut.setContentSize(80, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
        this.sp.spriteFrame = this.jump[0];                  // 落地蹲帧
        const overshoot = l < 0.45 ? Math.sin((0.45 - l) / 0.45 * Math.PI) * 0.13 : 0;
        const ry = (1 - l * 0.34) * (1 + overshoot);
        const cy = Math.max(0.6, Math.min(1.45, 1 + (ry - 1) * 0.4));
        const cx = Math.max(0.7, 1 - (ry - 1) * 0.2);
        this.node.setScale((dir >= 0 ? -this.S : this.S) * cx, this.S * cy, 1);
      } else {
        this.ut.setContentSize(80, 56); this.ut.setAnchorPoint(0.5, 4 / 56);   // 锚点上提=人下沉,脚踩进路里
        const idx = mode === 'walk' ? (Math.floor(walkPhase) % 4) : 0;
        this.sp.spriteFrame = this.foot[idx];
      }
    }
  }

  destroy() {
    if (this.node && this.node.isValid) this.node.destroy();
    if (this.fxSlamN && this.fxSlamN.isValid) this.fxSlamN.destroy();
    if (this.boltG && this.boltG.node.isValid) this.boltG.node.destroy();
    if (this.dimG && this.dimG.node.isValid) this.dimG.node.destroy();
    if (this.shadowG && this.shadowG.node.isValid) this.shadowG.node.destroy();
  }
}
