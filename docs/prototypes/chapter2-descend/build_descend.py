import os, glob, base64
from PIL import Image
SP="/private/tmp/claude-501/-Users-zhangsong-Desktop-claudework-sanguo-sanguococos/9454715d-ed17-43fb-9938-49f85a8b095f/scratchpad"
D=os.path.expanduser("~/Downloads")
def find(pat): return max(glob.glob(os.path.join(D,pat)), key=os.path.getmtime)  # 取最新

def b64(im,fmt="PNG"):
    import io; buf=io.BytesIO(); im.save(buf,fmt,optimize=True)
    mime="jpeg" if fmt=="JPEG" else "png"
    return f"data:image/{mime};base64,"+base64.b64encode(buf.getvalue()).decode()

# ① middle wall (opaque)
mid=Image.open(find("*endless_middle_section_of_a_round_s*")).convert("RGB")
mid.thumbnail((640,1200),Image.LANCZOS)
MID=b64(mid,"JPEG")

# ② ③ side walls: 绿幕 → 扣绿 + 裁到墙体
def keygreen(im):
    im=im.convert("RGBA");px=im.load();w,h=im.size
    for y in range(h):
        for x in range(w):
            r,g,b,a=px[x,y]
            if g>85 and g>r*1.3 and g>b*1.3: px[x,y]=(r,g,b,0)
            elif g>r and g>b:
                m=max(r,b); px[x,y]=(r,int(m+(g-m)*0.4),b,a)
    return im
def wall(pat):
    im=Image.open(find(pat)).convert("RGB")
    im.thumbnail((520,900),Image.LANCZOS)
    im=keygreen(im)
    bb=im.getbbox()
    if bb: im=im.crop(bb)
    im.thumbnail((300,640),Image.LANCZOS)
    return b64(im,"PNG")
LEFT=wall("*left_interior_vertical_well_wall_strip*")
RIGHT=wall("*right_interior_vertical_well_wall_strip*")

# ⑥ platforms: 新绿幕排图 → 连通域切单件(左→右映射)
def slice_row(pat,keys):
    from collections import deque
    sheet=Image.open(find(pat)).convert("RGB")
    sheet.thumbnail((980,560),Image.LANCZOS)
    im=keygreen(sheet);w,h=im.size;px=im.load()
    seen=bytearray(w*h);comps=[]
    for Y in range(h):
        base=Y*w
        for X in range(w):
            if seen[base+X]:continue
            seen[base+X]=1
            if px[X,Y][3]<25:continue
            q=deque([(X,Y)]);minx=maxx=X;miny=maxy=Y;cnt=0
            while q:
                x,y=q.popleft();cnt+=1
                if x<minx:minx=x
                if x>maxx:maxx=x
                if y<miny:miny=y
                if y>maxy:maxy=y
                for dx in(-1,0,1):
                    for dy in(-1,0,1):
                        nx,ny=x+dx,y+dy
                        if 0<=nx<w and 0<=ny<h and not seen[ny*w+nx]:
                            seen[ny*w+nx]=1
                            if px[nx,ny][3]>=25:q.append((nx,ny))
            if cnt>400 and (maxx-minx)>20:comps.append((minx,miny,maxx,maxy))
    comps.sort(key=lambda c:c[0])
    out={}
    for i,(a,b,c,d) in enumerate(comps[:len(keys)]):
        cr=im.crop((a,b,c+1,d+1));cr.thumbnail((320,220),Image.LANCZOS)
        out[keys[i]]=b64(cr,"PNG")
    return out
PLATS=slice_row("*2D_side-view_game_platform_assets*",["ledge","beam","slab","step"])
print("plats:",list(PLATS.keys()))
print("prepped. sizes(KB): mid",len(MID)//1024,"L",len(LEFT)//1024,"R",len(RIGHT)//1024,
      "plats",{k:len(v)//1024 for k,v in PLATS.items()})

# 墙面装饰件:绿幕 2 排 → 连通域自动切单件
def slice_decor():
    from collections import deque
    sheet=Image.open(find("*well-worn_wall_decorations*")).convert("RGB")
    sheet.thumbnail((720,1100),Image.LANCZOS)
    im=keygreen(sheet);w,h=im.size;px=im.load()
    seen=bytearray(w*h);comps=[]
    for Y in range(h):
        base=Y*w
        for X in range(w):
            if seen[base+X]:continue
            seen[base+X]=1
            if px[X,Y][3]<25:continue
            q=deque([(X,Y)]);minx=maxx=X;miny=maxy=Y;cnt=0
            while q:
                x,y=q.popleft();cnt+=1
                if x<minx:minx=x
                if x>maxx:maxx=x
                if y<miny:miny=y
                if y>maxy:maxy=y
                for dx in(-1,0,1):
                    for dy in(-1,0,1):
                        nx,ny=x+dx,y+dy
                        if 0<=nx<w and 0<=ny<h and not seen[ny*w+nx]:
                            seen[ny*w+nx]=1
                            if px[nx,ny][3]>=25:q.append((nx,ny))
            if cnt>500 and (maxx-minx)>10 and (maxy-miny)>10:
                comps.append((minx,miny,maxx,maxy))
    out=[]
    for a,b,c,d in comps:
        cr=im.crop((a,b,c+1,d+1));cr.thumbnail((200,200),Image.LANCZOS)
        out.append(b64(cr,"PNG"))
    return out
DECOR=[]  # 装饰件已去掉

import json
HTML=r"""<title>第二章 · 投井下降(真图 demo)</title>
<style>
  :root{--serif:"Songti SC","STSong",serif;--sans:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;--mono:ui-monospace,Menlo,monospace}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;
    background:radial-gradient(700px 400px at 50% -8%,#3a2c22,transparent 60%),#1a140f;color:#e8dcc8;font-family:var(--sans);padding:18px 14px 34px}
  h1{font-family:var(--serif);font-size:clamp(20px,4vw,30px);letter-spacing:.12em;margin:2px 0;color:#e9c98a}
  .sub{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#a08a68;margin-bottom:12px}
  .frame{position:relative;border-radius:16px;overflow:hidden;box-shadow:0 30px 70px -30px #000,0 0 0 5px #2a2018,0 0 0 6px #45341f}
  canvas{display:block;touch-action:none;background:#140f0b}
  .hud{position:absolute;inset:0;pointer-events:none;font-family:var(--mono)}
  .depth{position:absolute;right:9px;top:12px;bottom:12px;width:10px;background:rgba(0,0,0,.4);border-radius:6px;overflow:hidden;box-shadow:inset 0 0 0 1.5px rgba(220,180,110,.4)}
  .df{position:absolute;left:0;right:0;top:0;background:linear-gradient(#e9c98a,#b8703f);border-radius:6px;transition:height .2s}
  .dl{position:absolute;right:24px;top:12px;font-family:var(--serif);font-size:13px;color:#e9c98a;text-shadow:0 1px 3px #000}
  .zone{position:absolute;left:0;right:0;top:36%;text-align:center;font-family:var(--serif);font-size:32px;color:#f3e2c0;text-shadow:0 3px 14px #000;opacity:0;transition:opacity .5s;letter-spacing:.3em}
  .banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(20,14,10,.7);backdrop-filter:blur(3px);text-align:center;pointer-events:auto;transition:opacity .4s;padding:22px}
  .banner h2{font-family:var(--serif);font-size:clamp(24px,6vw,40px);letter-spacing:.1em;margin:0 0 8px;color:#e9c98a}
  .banner p{font-size:14px;color:#c9b38f;margin:0 0 20px;max-width:30ch;line-height:1.7}
  .banner.hide{opacity:0;pointer-events:none}
  .btn{font-family:var(--serif);font-size:18px;letter-spacing:.12em;color:#1a140f;background:linear-gradient(120deg,#e9c98a,#c8894a);border:0;border-radius:30px;padding:12px 34px;cursor:pointer;box-shadow:0 10px 24px -8px rgba(200,140,70,.7)}
  .load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--serif);letter-spacing:.2em;color:#c9b38f;background:#140f0b;z-index:5}
  .touch{position:absolute;inset:0;pointer-events:none;display:none}
  .tb{position:absolute;bottom:16px;width:54px;height:54px;border-radius:50%;background:rgba(50,38,26,.7);border:2px solid #6b512f;display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:19px;color:#e9c98a;pointer-events:auto;user-select:none;-webkit-user-select:none}
  .tb:active{background:#5a4326}
  .tL{left:14px}.tR{left:76px}.tDp{left:45px;bottom:16px;width:110px;border-radius:28px;font-size:14px}.tJ{right:14px}
  @media (hover:none){.touch{display:block}.keys{display:none}}
  .keys{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
  .key{font-family:var(--mono);font-size:12px;color:#c9b38f;background:#241a12;border:1.5px solid #45341f;border-radius:8px;padding:5px 10px}
  .key b{color:#e9c98a;font-family:var(--serif)}
  .note{color:#9c876a;font-size:12.5px;margin-top:12px;max-width:60ch;text-align:center;line-height:1.6}
</style>
<h1>第二章 · 投井下降</h1>
<div class="sub">descend · 你的真图井壁 + 平台</div>
<div class="frame">
  <canvas id="g" width="460" height="760"></canvas>
  <div class="hud">
    <div class="dl" id="dl">井口</div>
    <div class="depth"><div class="df" id="df" style="height:0%"></div></div>
    <div class="zone" id="zone"></div>
  </div>
  <div class="touch">
    <div class="tb tL" data-k="left">◀</div><div class="tb tR" data-k="right">▶</div>
    <div class="tb tDp" data-k="drop">下 ▼</div><div class="tb tJ" data-k="jump">跳</div>
  </div>
  <div class="banner" id="banner"><h2>投井入冥</h2>
    <p>纵身入井，踩着<b style="color:#e9c98a">凸砖 · 木梁 · 石台</b>一路往下。<b style="color:#e9c98a">按 ▼ 穿过脚下平台</b>继续下坠，坠到井底。</p>
    <button class="btn" id="startBtn">投井</button></div>
  <div class="load" id="load">载入井壁…</div>
</div>
<div class="keys">
  <span class="key"><b>A/D</b> 左右</span><span class="key"><b>S/▼</b> 穿台下落</span><span class="key"><b>空格</b> 小跳</span>
</div>
<p class="note">这是你生成的<b>①井壁中段（竖向滚动）+ ②③左右井壁（框边）+ ⑥平台（石台/木梁/石板，已扣底）</b>拼的真图下降关。中间小人是占位，正式换你第一章序列帧主角。</p>
<script>
const A=__ASSETS__;
const cv=document.getElementById('g'),ctx=cv.getContext('2d');
const W=460,H=760,DPR=Math.min(devicePixelRatio||1,2);
cv.width=W*DPR;cv.height=H*DPR;ctx.scale(DPR,DPR);
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
const IMG={};let need=0,got=0;
function ld(k,src){need++;const im=new Image();im.onload=()=>{IMG[k]=im;if(++got===need)ready();};im.onerror=()=>{if(++got===need)ready();};im.src=src;}
ld('mid',A.mid);ld('ledge',A.plats.ledge);ld('beam',A.plats.beam);ld('slab',A.plats.slab);ld('step',A.plats.step);
const DEC=[];

const PT={ledge:{w:172,sf:0.30},beam:{w:190,sf:0.30},slab:{w:170,sf:0.30},step:{w:150,sf:0.26}};
const KINDS=['ledge','beam','slab','step'];
const ZONES=[{y:0,n:'井口'},{y:1500,n:'井壁'},{y:3200,n:'深井'},{y:4800,n:'井底'}];
const GOAL=5600;
function zoneAt(y){let z=ZONES[0];for(const q of ZONES)if(y>=q.y)z=q;return z.n;}

const keys={left:0,right:0};
let mode='para';   // para=平视+视差, flat=正面平墙
let p,plats,parts,camY,spawnY,state,curZ,zoneT,depthMax;
let lanterns,nextLant,lantSide,motes,drips,dripT,decorItems,nextDecor,rowSide,longCd;
function reset(){
  p={x:70,y:40,vx:0,vy:0,onG:false,dir:1,dropT:0,plat:null,sq:1,bob:0};
  plats=[];parts=[];camY=-160;spawnY=210;curZ='井口';zoneT=0;depthMax=0;rowSide=-1;longCd=3;
  {const sx=PT['slab'].w/2-18;plats.push({x:sx,y:150,k:'slab',side:-1,L:sx-PT['slab'].w/2,R:sx+PT['slab'].w/2});}   // 井口起步台(贴左壁)
  while(spawnY<H+400)genRow();
  lanterns=[];nextLant=380;lantSide=1;
  motes=[];for(let i=0;i<64;i++)motes.push({x:Math.random()*W,y:Math.random()*H,sp:.3+Math.random()*.8,ph:Math.random()*6.28,r:.5+Math.random()*1.8});
  drips=[];dripT=0.2;
  decorItems=[];nextDecor=300;
  updateHUD();
}
function genRow(){
  let makeLong=false;
  if(longCd>0)longCd--;else if(Math.random()<0.42){makeLong=true;longCd=3;}
  if(makeLong){                                       // 很长的横板:横跨井筒,一侧留缺口
    const gapSide=Math.random()<0.5?-1:1,gap=116;
    const L=gapSide<0?gap:0,R=gapSide<0?W:W-gap;
    plats.push({y:spawnY,k:'slab',long:true,L,R,gapSide});
    spawnY+=150+Math.random()*60;
  } else {
    const k=KINDS[Math.floor(Math.random()*KINDS.length)];
    const w=PT[k].w;rowSide*=-1;const side=rowSide;   // 左右交替,贴墙
    const x=side<0? w/2-30 : W-w/2+30;                 // 墙侧多插进井壁,消缝
    plats.push({x,y:spawnY,k,side,L:x-w/2,R:x+w/2});
    spawnY+=112+Math.random()*70;
  }
}
function press(k,v){if(k in keys){keys[k]=v;return;}if(v){if(k==='jump')jump();else if(k==='drop')drop();}}
addEventListener('keydown',e=>{if(e.repeat)return;const c=e.code;
  if(c==='KeyA'||c==='ArrowLeft')press('left',1);else if(c==='KeyD'||c==='ArrowRight')press('right',1);
  else if(c==='Space'||c==='KeyW'||c==='ArrowUp'){press('jump',1);e.preventDefault();}
  else if(c==='KeyS'||c==='ArrowDown'){press('drop',1);e.preventDefault();}});
addEventListener('keyup',e=>{const c=e.code;if(c==='KeyA'||c==='ArrowLeft')press('left',0);else if(c==='KeyD'||c==='ArrowRight')press('right',0);});
document.querySelectorAll('.tb').forEach(b=>{const k=b.dataset.k;const on=e=>{e.preventDefault();press(k,1);},off=e=>{e.preventDefault();press(k,0);};
  b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointerleave',off);b.addEventListener('pointercancel',off);});
function jump(){if(state.run&&p.onG){p.vy=-330;p.onG=false;p.plat=null;poof(p.x,p.y,4);}}
function drop(){if(state.run&&p.onG){p.dropT=0.3;p.onG=false;p.plat=null;}}
function poof(x,y,n){for(let i=0;i<n;i++){const a=Math.random()*6.28,s=30+Math.random()*90;parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-30,life:.5,r:2+Math.random()*2});}}
function splash(x,y){for(let i=0;i<8;i++){const a=-Math.PI/2+(Math.random()-.5)*2.5,s=36+Math.random()*95;parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.4,r:.8+Math.random()*1.5,wet:1});}}

function update(dt){
  state.t+=dt;
  const mv=(keys.right?1:0)-(keys.left?1:0);
  if(mv){p.vx=mv*175;p.dir=mv;}else p.vx*=0.7;
  p.x+=p.vx*dt;p.x=Math.max(60,Math.min(W-60,p.x));
  p.vy+=1250*dt;p.vy=Math.min(p.vy,600);p.y+=p.vy*dt;
  if(p.dropT>0)p.dropT-=dt;p.bob+=dt*10;
  if(p.vy>0&&p.dropT<=0){for(const pl of plats){const top=pl.y,pf=p.y-p.vy*dt+16,f=p.y+16;
    if(pf<=top+5&&f>=top&&p.x>=pl.L-4&&p.x<=pl.R+4){p.y=top-16;p.vy=0;p.onG=true;p.plat=pl;p.sq=0.7;break;}}}
  if(p.onG&&p.plat&&(p.x<p.plat.L-4||p.x>p.plat.R+4)){p.onG=false;p.plat=null;}
  p.sq+=(1-p.sq)*Math.min(1,dt*10);
  const tgt=p.y-H*0.32;camY+=(tgt-camY)*Math.min(1,dt*4);if(camY<p.y-H*0.55)camY=p.y-H*0.55;
  depthMax=Math.max(depthMax,p.y);
  while(spawnY<camY+H+400)genRow();
  plats=plats.filter(pl=>pl.y>camY-160);
  while(nextLant<camY+H+420){lanterns.push({y:nextLant,side:lantSide,ph:Math.random()*6.28});nextLant+=430;lantSide*=-1;}
  lanterns=lanterns.filter(l=>l.y>camY-180);
  while(DEC.length&&nextDecor<camY+H+400){decorItems.push({y:nextDecor,t:Math.floor(Math.random()*DEC.length),x:60+Math.random()*(W-120),s:0.62+Math.random()*0.32,flip:Math.random()<0.5});nextDecor+=420+Math.random()*320;}
  decorItems=decorItems.filter(d=>d.y>camY-300);
  for(const m of motes){m.x+=Math.sin(state.t*m.sp*0.7+m.ph)*11*dt;m.y+=Math.cos(state.t*m.sp*0.5+m.ph*1.7)*7*dt;
    if(m.x<-4)m.x=W+4;else if(m.x>W+4)m.x=-4;if(m.y<-4)m.y=H+4;else if(m.y>H+4)m.y=-4;}
  dripT-=dt;if(dripT<=0){dripT=0.7+Math.random()*0.9;const r=Math.random();
    const dx = r<0.2 ? W*0.32+Math.random()*W*0.36 : (r<0.6 ? 22+Math.random()*90 : W-112+Math.random()*90);
    drips.push({x:dx,y:-10,vy:24+Math.random()*20,len:5+Math.random()*7,sp:0});}
  for(const d of drips){if(d.sp)continue;d.vy+=240*dt;d.y+=d.vy*dt;
    let hit=-1;
    for(const pl of plats){const psy=pl.y-camY;if(d.y>=psy-3&&d.y<=psy+9&&d.x>=pl.L&&d.x<=pl.R){hit=psy;break;}}
    if(hit<0&&d.y>H*0.94)hit=d.y;
    if(hit>=0){d.sp=1;splash(d.x,hit);}}
  drips=drips.filter(d=>!d.sp&&d.y<H+16);
  const zn=zoneAt(p.y);if(zn!==curZ){curZ=zn;showZone(zn);}
  for(const pt of parts){pt.life-=dt;pt.x+=pt.vx*dt;pt.y+=pt.vy*dt;pt.vy+=300*dt;}
  parts=parts.filter(pt=>pt.life>0);
  if(zoneT>0){zoneT-=dt;if(zoneT<=0)document.getElementById('zone').style.opacity=0;}
  updateHUD();
  if(p.y>=GOAL)end(true);
}
function updateHUD(){document.getElementById('df').style.height=Math.max(0,Math.min(100,p.y/GOAL*100))+'%';document.getElementById('dl').textContent=curZ;}
function showZone(n){const el=document.getElementById('zone');el.textContent=n;el.style.opacity=1;zoneT=1.4;}

// tiled vertical bg
function bgTile(img,x0,dw,par,alpha){
  if(!img)return;const off=camY*par;const dh=dw*img.height/img.width;
  const i0=Math.floor(off/dh);ctx.globalAlpha=alpha==null?1:alpha;
  for(let i=i0;i*dh<off+H+dh;i++){const sy=i*dh-off;
    if(i&1){ctx.save();ctx.translate(x0,sy+dh);ctx.scale(1,-1);ctx.drawImage(img,0,0,dw,dh);ctx.restore();} // 奇数张竖向镜像 → 接缝对齐
    else ctx.drawImage(img,x0,sy,dw,dh);}
  ctx.globalAlpha=1;
}
// 前景侧墙:贴左右,滚得比角色快(近)→ 视差立体感
function fgWall(img,side){
  if(!img)return;
  const dw=118, dh=dw*img.height/img.width, off=camY*1.22;
  const base=Math.floor(off/dh)*dh;
  const x0=side==='left'?-6:W-dw+6;
  for(let wy=base;wy<off+H+dh;wy+=dh){
    if(side==='right'){ctx.save();ctx.translate(x0+dw,wy-off);ctx.scale(-1,1);ctx.drawImage(img,0,0,dw,dh);ctx.restore();}
    else ctx.drawImage(img,x0,wy-off,dw,dh);
  }
  // 近景压暗 + 内缘柔化融进通道
  const g=side==='left'?ctx.createLinearGradient(0,0,dw+34,0):ctx.createLinearGradient(W,0,W-dw-34,0);
  g.addColorStop(0,'rgba(10,7,4,0.5)');g.addColorStop(0.62,'rgba(10,7,4,0.22)');g.addColorStop(1,'rgba(10,7,4,0)');
  ctx.fillStyle=g;
  if(side==='left')ctx.fillRect(0,0,dw+34,H);else ctx.fillRect(W-dw-34,0,dw+34,H);
}
// 壁灯:暖光池 + 灯体(等距挂墙,做设计感 + 微光源)
function drawLantern(x,sy,ph){
  const fl=0.82+0.18*Math.sin(state.t*4+ph);
  const g=ctx.createRadialGradient(x,sy,2,x,sy,96);
  g.addColorStop(0,'rgba(255,182,92,'+(0.5*fl)+')');g.addColorStop(0.5,'rgba(228,138,58,'+(0.13*fl)+')');g.addColorStop(1,'transparent');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,sy,96,0,6.28);ctx.fill();
  ctx.fillStyle='#241a12';ctx.fillRect(x-1.5,sy-26,3,10);
  ctx.fillStyle='#33261a';ctx.beginPath();ctx.roundRect(x-8,sy-18,16,22,4);ctx.fill();
  ctx.fillStyle='rgba(255,205,120,'+fl+')';ctx.beginPath();ctx.roundRect(x-5,sy-15,10,16,3);ctx.fill();
  ctx.fillStyle='rgba(255,244,205,'+fl+')';ctx.beginPath();ctx.arc(x,sy-7,3,0,6.28);ctx.fill();
}
function drawPlat(pl){
  const y=pl.y-camY;
  if(pl.long){                                   // 长横板:一根木梁横向拉伸,横跨井筒
    const img=IMG.beam;if(!img)return;
    let dL=pl.L,dR=pl.R;
    if(pl.gapSide<0)dR=W+26;else dL=-26;   // 墙侧插进井壁,消除缝隙
    const dw=dR-dL,dh=Math.min(64,dw*img.height/img.width),topY=y-dh*0.30;
    ctx.fillStyle='rgba(0,0,0,.26)';ctx.beginPath();ctx.ellipse((dL+dR)/2,y+5,dw/2*0.9,5,0,0,6.28);ctx.fill();
    ctx.drawImage(img,dL,topY,dw,dh);
    return;
  }
  const img=IMG[pl.k];if(!img)return;const t=PT[pl.k];
  const w=t.w,h=w*img.height/img.width;
  // 接墙投影:平台在井壁上投下的软影(卖"从墙上戳出来")
  if(pl.side){const ex=pl.side<0?0:W;const g=ctx.createLinearGradient(ex,0,ex+pl.side*90,0);
    g.addColorStop(0,'rgba(0,0,0,0.34)');g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.fillRect(pl.side<0?0:W-90,y-t.sf*h+h*0.2,90,h*0.9);}
  ctx.fillStyle='rgba(0,0,0,.26)';ctx.beginPath();ctx.ellipse(pl.x,y+4,w*0.4,5,0,0,6.28);ctx.fill();
  ctx.save();ctx.translate(pl.x,y-t.sf*h);
  if(pl.side>0)ctx.scale(-1,1);
  ctx.drawImage(img,-w/2,0,w,h);
  ctx.restore();
}
function drawHero(){
  const sy=p.y-camY;
  if(p.plat){ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(p.x,p.plat.y-camY-1,13,4,0,0,6.28);ctx.fill();}
  ctx.save();ctx.translate(p.x,sy);ctx.scale(p.dir,1);ctx.scale(2-p.sq,p.sq);
  // placeholder figure
  ctx.fillStyle='#2b2016';ctx.beginPath();ctx.roundRect(-9,-30,18,32,7);ctx.fill();
  ctx.fillStyle='#f2e6d0';ctx.beginPath();ctx.arc(0,-36,9,0,6.28);ctx.fill();
  ctx.fillStyle='#4a3a28';ctx.beginPath();ctx.arc(-3,-36,1.8,0,6.28);ctx.arc(3,-36,1.8,0,6.28);ctx.fill();
  ctx.strokeStyle='#e9c98a';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-9,-28);ctx.quadraticCurveTo(-13,-14,-8,0);ctx.stroke();
  ctx.restore();
}
function render(){
  ctx.fillStyle='#140f0b';ctx.fillRect(0,0,W,H);
  // 背景井壁(满铺,滚得慢=在后面)
  bgTile(IMG.mid,0,W,0.82);
  const dk=Math.min(0.5,Math.max(0,(camY)/GOAL*0.55));
  ctx.fillStyle='rgba(10,6,3,'+dk+')';ctx.fillRect(0,0,W,H);
  // 墙面装饰件:稀疏 + 缩小 + 投影 → 像长在墙上,不复读
  for(const d of decorItems){const img=IMG['dc'+d.t];if(!img)continue;const sy=d.y-camY;if(sy<-220||sy>H+220)continue;
    const mx=Math.max(img.width,img.height),sc=(78*d.s)/mx,dw=img.width*sc,dh=img.height*sc;
    ctx.save();ctx.translate(d.x,sy);if(d.flip)ctx.scale(-1,1);
    ctx.shadowColor='rgba(0,0,0,0.5)';ctx.shadowBlur=7;ctx.shadowOffsetX=3;ctx.shadowOffsetY=4;
    ctx.globalAlpha=0.92;ctx.drawImage(img,-dw/2,-dh/2,dw,dh);ctx.restore();}
  // platforms + hero, depth sorted by y
  const list=plats.filter(pl=>pl.y>camY-120&&pl.y<camY+H+120).sort((a,b)=>a.y-b.y);
  for(const pl of list){if(pl.y<=p.y)drawPlat(pl);}
  drawHero();
  for(const pl of list){if(pl.y>p.y)drawPlat(pl);}
  // top light shaft (fades with depth)
  const lt=Math.max(0,1-camY/1200);
  if(lt>0){const g=ctx.createLinearGradient(0,0,0,H*0.5);g.addColorStop(0,'rgba(255,225,160,'+(0.5*lt)+')');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,W,H*0.5);}
  // particles
  for(const pt of parts){ctx.globalAlpha=Math.max(0,pt.life*(pt.wet?2.4:2));ctx.fillStyle=pt.wet?'rgba(228,234,224,0.95)':'#d8c4a0';ctx.beginPath();ctx.arc(pt.x,pt.y,pt.r,0,6.28);ctx.fill();}
  ctx.globalAlpha=1;
  // 光尘(暖色浮尘)→ 空气感
  for(const m of motes){ctx.globalAlpha=0.18+0.30*(0.5+0.5*Math.sin(state.t*m.sp+m.ph));ctx.fillStyle='rgba(255,222,162,0.6)';ctx.beginPath();ctx.arc(m.x,m.y,m.r,0,6.28);ctx.fill();}
  ctx.globalAlpha=1;
  // 水滴(细亮streaks + 亮头)
  ctx.strokeStyle='rgba(224,222,208,0.5)';ctx.lineWidth=1.6;ctx.lineCap='round';
  for(const d of drips){ctx.beginPath();ctx.moveTo(d.x,d.y-d.len);ctx.lineTo(d.x,d.y);ctx.stroke();
    ctx.fillStyle='rgba(255,250,236,0.75)';ctx.beginPath();ctx.arc(d.x,d.y,1.4,0,6.28);ctx.fill();}
  // vignette
  const v=ctx.createRadialGradient(W/2,H/2,H*0.3,W/2,H/2,H*0.75);v.addColorStop(0,'transparent');v.addColorStop(1,'rgba(0,0,0,.55)');ctx.fillStyle=v;ctx.fillRect(0,0,W,H);
}
let last=performance.now();
function loop(now){let dt=(now-last)/1000;last=now;dt=Math.min(dt,0.05);if(state.run)update(dt);render();requestAnimationFrame(loop);}
const banner=document.getElementById('banner');
state={run:false,t:0};
function start(){reset();state={run:true,t:0};banner.classList.add('hide');}
function end(win){state.run=false;banner.querySelector('h2').textContent='坠抵井底';
  banner.querySelector('p').innerHTML='一路下到井底。<br>下一步:井底水面 → 马面 Boss。';
  banner.querySelector('.btn').textContent='再投一次';banner.classList.remove('hide');}
document.getElementById('startBtn').addEventListener('click',start);
function ready(){document.getElementById('load').style.display='none';reset();requestAnimationFrame(loop);}
</script>"""
ASSETS=json.dumps({"mid":MID,"plats":PLATS})
HTML=HTML.replace("__ASSETS__",ASSETS)
open(os.path.join(SP,"descend2.html"),"w").write(HTML)
print("wrote descend2.html",round(len(HTML)/1024),"KB")
