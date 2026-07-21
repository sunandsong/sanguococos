// ─────────────────────────────────────────────────────────────
// 跳跃物理套件:全章节共用一套参数(第一章/井/洞/以后的第三章…)。
//   单位 = 屏幕像素。非屏幕像素坐标系的场景(如井关 demo 坐标)用自己的
//   SCALE 换算:vy = JUMP.VY / SCALE。改跳跃手感只改这里,所有章一起变。
//   空中挤压拉伸的视觉部分在 HeroRig 的 air 模式(jumpRefVy 同源此处)。
// ─────────────────────────────────────────────────────────────
export const JUMP = {
  VY: 900,          // 普通跳跃起跳速度
  AIR_VY: 828,      // 二段跳(空中连跳)起跳速度 = VY×0.92
  MAX_JUMPS: 2,     // 连跳段数:地面起跳 + 空中再跳一次
  GRAVITY: 2500,    // 跳跃重力(跳高 = VY²/2G ≈ 162px)
  SLAM_VY: 980,     // 第3段跳劈起跳速度(比普通跳更高,与第一章一致)
  FALL_CAP: 1150,   // 最大下落速度(第一章无封顶,井关下落/入水需要)
};

/** 连跳判定(全章共用):地面=正常起跳;空中(含走落悬空)还有段数=二段跳。
 *  场景自己维护 jumpsUsed 计数(落地清零),把返回的 used 写回去;不能跳返回 null。
 *  非屏幕像素坐标系的场景照旧自己 ÷SCALE。 */
export function tryJump(onGround: boolean, jumpsUsed: number): { vy: number; used: number } | null {
  if (onGround) return { vy: JUMP.VY, used: 1 };
  if (jumpsUsed < JUMP.MAX_JUMPS) return { vy: JUMP.AIR_VY, used: JUMP.MAX_JUMPS };
  return null;
}
