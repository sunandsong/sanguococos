# 美术风格锚 · Q版可爱(全篇统一)

> **决定(2026-07-17)**:《碧落黄泉》全篇美术目标风格 = **Q版可爱(chibi kawaii pixel)**,第一章也换。
> 所有 AI 生成(角色 / 敌人 / 背景 / 道具 / UI)都必须**带下面的「风格锚」提示词片段 + 挂同一张风格参考图**,整体才统一。
> 当前三国占位美术逐步替换成 Q版。**过渡期**会有「Q版背景 + 老赵云(正常比例)」暂时不搭,属正常,等角色也换成 Q版即统一。

---

## 一、核心风格(一句话)
可爱 Q版像素:**大头小身(super-deformed,约 2–2.5 头身)**、圆润柔和、干净描边、明亮暖色、绘本感。

## 二、风格锚 · 提示词片段(每条生成都加在开头)

**▶ 角色 / 敌人 / 道具(透明背景精灵):**
```
cute chibi kawaii pixel art, storybook, super-deformed big-head small-body (about 2 heads tall),
rounded soft shapes, clean outlines, bright warm soft shading, limited cozy palette,
transparent background PNG, side view
```

**▶ 角色·丑萌怪诞修饰(2026-07-18 定版,主角定妆采用;出"人物/生物"时叠加在上面片段之后):**
> 关键词:**busaiku kawaii(不细工可爱)+ 怪诞感**。大头占全身 70%、五官挤在下半脸、
> 一大一小眼、歪嘴、身体小豆芽、武器比人大、线条简单微抖的手绘感。
```
ugly-cute (busaiku kawaii), quirky grotesque charm, simple clean lines,
gigantic round-ish lumpy head taking up 70% of the whole body,
facial features squeezed into the lower half of the face,
one big round eye and one smaller eye slightly apart, tiny crooked smile,
tiny sprout-like body, weapon much taller than the character,
flat colors, bold simple outlines, slightly wobbly hand-drawn feel but clean silhouette
```

**▶ 横版背景(场景):**
```
cute chibi kawaii pixel art storybook, side-scrolling platformer level background,
flat side elevation orthographic view, camera parallel to the scene, wide 16:9,
runs left-to-right along a flat ground line, depth as flat parallel parallax layers
(foreground / midground / background) NOT perspective, bright warm cozy, rounded soft shapes
```

**▶ 通用负面(每条都加):**
```
realistic, gritty, semi-realistic, adult proportions, tall body, detailed anatomy,
scary, dark, gloomy, horror, blood, gore,
one-point perspective, vanishing point, tunnel into screen, isometric, 3/4 view, top-down, front view,
neon, sci-fi, modern, text, watermark, seams
```

**▶ 光泽感(2026-07-18 定版,角色/怪/道具类提示词都带):**
> 平涂图进游戏显得干瘪没质感,提示词一律加光泽配方(光源统一左上,与程序打光同向):
```
soft volumetric shading with glossy highlights, light from the upper left, subtle rim light on the edges
```
> 负向加:`flat dull colors, matte lifeless surface`

**▶ 像素感(2026-07-19 改版):**
> **提示词不加像素关键词**(AI 原生像素块太大太糙,试过效果差)——照常出平滑Q版图。
> **背景/场景贴图不加颗粒**(2026-07-19 定):抠底、接缝照做,平滑原图直接进游戏,引擎滤波 LINEAR(空城五层起)。
> 角色/怪类沿用质感全家桶(2px 描边+打光+3/4 颗粒+量化96色);新角色接图前先确认颗粒还要不要。

## 三、规则
1. **比例统一**:大头小身,别忽高忽矮;角色比例定死后,所有单位照它。
1.5 **像素感统一**:出平滑图,接图后必过颗粒后处理(见上);提示词不加像素关键词。
2. **地府不吓人**:靠**亮色 + 暖光 + 美的元素**(彼岸花 / 灯笼 / 温柔发光生灵)达成"美而不阴森";禁恐怖 / 血腥。
3. **横版背景**:必须 **flat side elevation + 平行分层**,不能透视往屏幕里钻(那不是能卷动的横版图);可平铺的开 seamless。
4. **一致性**:先出**一张风格参考图**(建议 Q版**主角**),之后所有图挂它当 **reference(IP-Adapter)**锁色调线条。
5. **精灵做序列帧**:角色 / 敌人出**动作帧**,后处理切 sheet 接 `HeroRig`。

## 四、需替换成 Q版 的清单(逐步)
- 🔴 **主角**(占位文件名 `zhaoyun-*`,与三国无关,换角色时改名):`foot / jump / attack / slam / swim / swim-h / float / slide / horse` + `avatar-zhaoyun`(头像)
- 🔴 **敌人 / Boss**:`enemy-infantry / guard / heavy / archer`、`enemy-xuchu`(许褚)、`boss-niutou`(牛头)
- 🔴 **背景**:第一章 `bg-far/mid/near-forest`、`bg-fg-forest/stone`;地府 黄泉花境 / 城市 / 城堡 / 地牢通道
- 🟡 **建议换**:`title-logo/bg`、Boss 道具(曹旗 / 火盆 / 断枪 / 破盾 / 拒马)、`critter-*` / `grass-*`
- 🟢 **多半能留**:光效(`fx-crescent / shockwave / slam-impact / rune-circle / dot / mote`)、雨雪落叶 —— 抽象,Q版也不违和

## 五、角色需要的动作帧(出图照这套)
待机 / 走(4)、跳(蹲→伸展→屈腿 3)、横斩(4,连招 1·2 段共用)、跳劈(4,第 3 段大招)、
水性(竖游 / 横游 / 踩水 / 滑行)、阵亡(程序化)。新场景要新动作(如爬行 crawl / 攀爬 climb)另出该套帧。

## 六、⭐ 图必须支持「全屏无黑边」(硬性,以后改横屏/铺满不返工)
> 现在游戏是竖屏 720×1280;将来要在平板/PC **横屏铺满、无黑边**。所以**背景出图从一开始就得能自适应任意宽度**,否则以后全部重出。

**5 条规则:**
1. **可平铺层(远/中/近)= 左右无缝 + 无独特中心/边缘**——纯"能无限循环"的图,没有画死的焦点或左右端。任何宽度/比例都能铺满。
2. **满高 + 上下留余量**——覆盖整个画面高度,并上下各多画一截(天空/地面往外延),高度变化不露空。
3. **前景 / 道具 / 装饰 = 独立透明 PNG**——代码摆放,天然自适应。
4. **分辨率出大**(≥2×,如 1080×1920 或更高),放大到大屏不糊。
5. **地面线固定高度**,各层对齐同一处。

**背景层提示词加这一句:**
```
seamless endlessly repeatable, no distinct focal point, no fixed left/right edge, full height with extra sky above and ground below
```

**例外 · 单张整图(标题 / 剧情):** 没法平铺。做法:**主体居中 + 四周留可延伸的背景余量(safe area)**,横屏往两边延/裁;或到时单独再出横版(数量少,重出不心疼)。

> 一句话:**背景 = 满高 + 左右无缝 + 无焦点的可平铺层;前景 = 透明件。** 这样竖屏现在能用,横屏铺满也直接用。

## 七、尺寸表(给提示词时必须一并注明比例+像素)
| 类型 | 比例 | 像素尺寸 | 背景/格式 |
|---|---|---|---|
| 背景层 远/中/近 | 9:16 竖幅 | **1080×1920**(或更大) | **左右无缝**平铺 |
| 前景层(植被/石头) | 9:16 | 1080×1920 | **透明 PNG** |
| 标题背景 / 剧情整图 | 9:16 | 1080×1920 | 主体居中留 safe area |
| 角色/敌人/Boss 精灵 | 按体型 | 单帧建议 128×128 起,**序列帧横排** | **透明 PNG** |
| 道具/装饰/生物 | 按体型 | 小件 64–128,中件 128–256 | **透明 PNG**,会动的出序列帧 |
| HUD 头像 | 1:1 | 128×128 | 透明或方框 |

> 出图**分辨率宁大勿小**(≥2×),引擎里再缩,清晰不糊。给提示词时**每次都写清比例+尺寸**。
