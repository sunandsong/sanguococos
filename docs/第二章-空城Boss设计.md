# 第二章 · 空城大 Boss「铁心兽」设计

> 2026-07-21。圆形竞技场 + 纵深走位(人物可上下移动) + 机械怪兽(机枪+炸弹)。
> 风格:Q版丑萌怪诞(见[美术风格锚](美术风格锚-Q版.md)),吓不着人但压迫感十足。

---

## 一、概念:铁心兽(空城的心脏)

全城人一夜消失,**城里被丢下的机器不甘心**——蒸汽锅炉当肚子、货车轮当腿、
钟楼齿轮当关节、哨塔机枪当手臂、烟囱当炸弹发射井……拼成一头**圆滚滚的机械怪兽**,
夜夜在城中心广场游荡,是空城怪物们的"头儿"。

**Q版丑萌锚**:锅炉大肚占全身 70%、一大一小两只铆钉眼(歪的)、
豁牙铁嘴咧着笑、短粗履带小腿倒腾、机枪臂比身子还长、背上三根烟囱弹舱突突冒烟。
凶但憨,像一台"想吓人却先把自己绊倒"的老机器。

## 二、场景:雾中圆形竞技场(嵌进现有流程)

```
街尾走进浓雾 → 雾"呼"地散开一圈 → 圆形竞技场(Boss 战,锁场)
→ 打赢 → 铁心兽大爆炸 → 雾彻底退散 → 老井显形 → 跳井接井关
```

- **场地**:城中心圆形广场——椭圆地面带(纵深带,上=远/下=近),四周一圈
  **浓雾墙**(就是现有的雾,天然的"圆形围栏",出不去);场边几个**石墩**(可被机枪打碎的临时掩体)
- **镜头**:CamZoom 登场时拉远看全场,战斗中腾空拉远照旧
- **纵深走位**:玩家上/下换"深度线"是核心防御手段(配合已有的上下移动)

## 三、Boss 结构(分体,复用分体枪技术)

| 部件 | 说明 | 行为 |
|---|---|---|
| **本体**(锅炉身+履带) | 大身体,慢速左右横移+偶尔换深度线 | 呼吸起伏、过热冒烟 |
| **机枪臂**(独立旋转) | 复用机枪妖的"枪独立瞄准"套路 | 实时追瞄→锁线开火 |
| **弹舱**(背上三烟囱) | 独立小节点 | 抛炸弹时后坐冒烟 |
| **核心**(锅炉门) | 三阶段才打开 | 弱点,受击双倍伤 |

**部件可破坏**:打累计伤害可敲掉机枪臂(机枪招式下线,掉一把金币)——奖励主动进攻。

## 四、招式(全部吃"上下走位"这口饭)

**① 机枪锁线扫射**(主力,考验换线)
- 枪口红点亮起→锁定玩家当前**深度线**→红色瞄准线预警 0.6s→沿该线横扫一梭子
- 破法:**上下换线**;贴掩体也可挡(石墩会被打碎,次数有限)

**② 扇形泼弹**(考验节奏)
- 枪臂从上线扫到下线(或反向),弹幕呈斜带推进
- 破法:**顺着扫向反跑 + 跳跃**穿空隙

**③ 炸弹抛射**(考验位置)
- 弹舱"咚咚咚"抛 1~3 颗抛物线炸弹,**落点红圈预警**(圈在某条深度线上)
- 落地爆炸,留 2s **火焰区**封走位
- 破法:看圈换线;可用**挥砍把空中炸弹打回去**(打回命中 Boss=硬直,高手爽点)

**④ 蒸汽冲撞**(输出窗口)
- 锅炉憋气(全身泛红)→沿当前线直线冲锋→撞进雾墙**自晕 3s**(星星转圈)
- 破法:侧移一线躲开 → 晕住随便打(三连+跳劈狂欢)

**⑤ 三阶段·过热狂暴**(血 ≤25%)
- 锅炉门崩开露**核心**;炸弹雨(全场 6~8 圈红圈)+ 机枪短点射交织
- 履带加速绕场半圈再冲撞;打核心双倍伤 → 速攻终结

**节奏表**:P1(100~60%)①③④循环,慢;P2(60~25%)加②,炸弹变 3 连;P3 狂暴。

## 五、打击感/演出(全部复用现成套件)

- 命中 Boss:顿帧/白光/火花(HitFx 全家桶);Boss 受击**铁皮铛铛弹缩**,掉螺丝钉粒子
- 敲掉部件:大顿帧+爆栓飞零件;死亡:**连环小爆→大爆炸→零件天女散花→慢动作**
  (对齐第一章 Boss 击杀慢动作),雾墙同步退散、老井从雾里显形
- 音:机枪哒哒(现有 hit 短音)、炸弹落地 land、冲撞 swing2

## 六、出图清单(带风格锚+尺寸;身/臂/弹分体)

**通用负面**:`realistic, gritty, scary, horror, gore, adult proportions, front view, perspective, text, watermark`

**① Boss 本体**(idle 2 帧:呼吸;`~520×480 ·2× · 透明PNG · 序列帧横排`)
```
cute chibi kawaii pixel art, storybook, ugly-cute (busaiku kawaii) quirky grotesque charm,
soft volumetric shading with glossy highlights, light from the upper left, subtle rim light,
transparent background PNG, side view; a chubby mechanical junk-beast boss: a big round rusty
boiler belly taking 70% of the body, one big round rivet eye and one smaller crooked eye,
grinning gap-toothed iron mouth, stubby caterpillar-track legs, three little chimney stacks
on its back puffing smoke, patched rusty metal in warm bronze and teal-grey, NO gun arm
(the machine-gun arm is a separate sprite), facing left
```

**② 机枪臂**(独立旋转;`~360×120 · 透明PNG · 枪管朝右,肩关节在左 1/3 处`)
```
cute chibi kawaii pixel art, storybook, ugly-cute quirky charm, glossy highlights, light from
the upper left, transparent background PNG, side view; a single oversized cartoon mechanical
machine-gun arm prop lying horizontal, barrel pointing right, round shoulder joint with big
rivets near the left third, ammo drum, chunky toy-like proportions, rusty bronze metal,
no character, no hands
```

**③ 炸弹**(单帧;`96×96 · 透明PNG`)
```
cute chibi kawaii pixel art, ugly-cute charm, glossy highlights, transparent background PNG;
a single round cartoon iron bomb with a short lit fuse spark, small crooked painted skull-face
(cute not scary), rusty black-bronze, side view
```

**④ 竞技场背景**(可选,圆形广场;`9:16 · 1080×1920 · 左右无缝`)
```
cute chibi kawaii pixel art storybook, side-scrolling level background, flat side elevation
orthographic camera parallel, vertical portrait 9:16, seamless horizontal tiling, flat parallax
layers NOT perspective; an abandoned circular town plaza at dusk: curved ring of broken railings
and lamp posts, cracked round flagstone floor with a big gear motif, drifting pale fog at the
edges, warm lamplight vs cool dusk, empty and quiet but NOT scary
```
> 也可先不出图:场地用现有街景+雾墙+代码画的圆形地纹开工。

## 七、实装计划(新场景 `Chapter2Arena.ts`)

1. **骨架**:世界容器+CamZoom+HeroRig+HeroCombat+TouchControls+HeroHUD+DeathFx 全套件一行接
2. **纵深带**:玩家 y 在 [近线,远线] 连续移动(或 3 线),Boss/炸弹/子弹都带深度,命中要求深度相近
3. **Boss 状态机**:idle→aim→sweep/fan/bomb/charge→(stun)→循环;P2/P3 换参数表
4. **入雾触发**改:街尾入雾 → Arena;胜利 → 雾散+井显形 → 跳井转场井关
5. 素材没到位前:本体/枪臂用程序画占位(圆锅炉+方枪管),先把手感调出来

---
**一句话**:铁心兽=空城被遗弃机器攒出来的丑萌心脏;圆形雾场里,机枪逼你换线、
炸弹逼你看地、冲撞给你窗口;打赢它,雾散井现,跳进下一章。
