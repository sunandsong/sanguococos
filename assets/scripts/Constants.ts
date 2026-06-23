// 固定设计分辨率：720×1280（标准竖屏手机）
// 大屏设备（iPad / 桌面）会上下/左右留黑边，不撑满
// 但保证元素永远不变形、不被放大到爆
export const DESIGN_W = 720;
export const DESIGN_H = 1280;

// 0~1 归一化坐标转 Cocos 居中坐标
export function dpx(fx: number): number { return (fx - 0.5) * DESIGN_W; }
export function dpy(fy: number): number { return (0.5 - fy) * DESIGN_H; }
