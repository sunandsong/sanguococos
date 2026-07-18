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

**▶ 像素感(2026-07-18 定版):**
> **提示词不加像素关键词**(AI 原生像素块太大太糙,试过效果差)——照常出平滑Q版图,
> 像素感全靠**接图时的统一后处理**:半分辨率重采样 → NEAREST 放大(≈1显示像素脆颗粒) + 量化 64~96 色。
> **按显示缩放补偿**:引擎里缩小显示的图层(如近/中景视差层)颗粒会被缩没,要加重到 1/4 重采样,保证屏幕上约 2 像素颗粒。
> 全项目已统一此质感(主角/背景/草株/前景叶),新素材不做会显得"贴纸"。

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
