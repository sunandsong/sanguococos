import os, glob, base64, io
from PIL import Image
SP="/private/tmp/claude-501/-Users-zhangsong-Desktop-claudework-sanguo-sanguococos/9454715d-ed17-43fb-9938-49f85a8b095f/scratchpad"
D=os.path.expanduser("~/Downloads")
def find(pat): return max(glob.glob(os.path.join(D,pat)),key=os.path.getmtime)
def b64jpg(im):
    im=im.convert("RGB");buf=io.BytesIO();im.save(buf,"JPEG",quality=70,optimize=True)
    return "data:image/jpeg;base64,"+base64.b64encode(buf.getvalue()).decode()
mid=Image.open(find("*endless_middle_section_of_a_round_s*"));mid.thumbnail((560,1050),Image.LANCZOS)
MID=b64jpg(mid)
welltop=Image.open(find("*top_of_an_ancient_stone_well_from_the_inside*"));welltop.thumbnail((560,1024),Image.LANCZOS)
WELLTOP=b64jpg(welltop)

# 平台:从绿幕平台排图切第一件(左侧砖台)
def keygreen(im):
    im=im.convert("RGBA");px=im.load();w,h=im.size
    for y in range(h):
        for x in range(w):
            r,g,b,a=px[x,y]
            if g>85 and g>r*1.3 and g>b*1.3: px[x,y]=(r,g,b,0)
            elif g>r and g>b:
                m=max(r,b);px[x,y]=(r,int(m+(g-m)*0.4),b,a)
    return im
def b64png(im):
    buf=io.BytesIO();im.save(buf,"PNG",optimize=True);return "data:image/png;base64,"+base64.b64encode(buf.getvalue()).decode()
def slice_first(pat):
    from collections import deque
    sheet=Image.open(find(pat)).convert("RGB");sheet.thumbnail((900,520),Image.LANCZOS)
    im=keygreen(sheet);w,h=im.size;px=im.load();seen=bytearray(w*h);comps=[]
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
    comps.sort(key=lambda c:c[0]);a,b,c,d=comps[0]
    cr=im.crop((a,b,c+1,d+1));cr.thumbnail((320,220),Image.LANCZOS);return b64png(cr)
LEDGEIMG=slice_first("*2D_side-view_game_platform_assets*")

HTML=r"""<title>方案A · 落水潜水(真井壁)</title>
<style>
  :root{--serif:"Songti SC","STSong",serif;--sans:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;--mono:ui-monospace,Menlo,monospace}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;
    background:radial-gradient(600px 400px at 50% -8%,#2a3326,transparent 60%),#0e1310;color:#d8e0d2;font-family:var(--sans);padding:18px 14px 34px}
  h1{font-family:var(--serif);font-size:clamp(20px,4vw,30px);letter-spacing:.12em;margin:2px 0;color:#a8c69a}
  .sub{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#6f8a66;margin-bottom:12px}
  .frame{position:relative;border-radius:16px;overflow:hidden;box-shadow:0 30px 70px -30px #000,0 0 0 5px #18201a,0 0 0 6px #2e3a2c}
  canvas{display:block;touch-action:none;background:#0e1712}
  .hud{position:absolute;inset:0;pointer-events:none;font-family:var(--mono)}
  .depth{position:absolute;right:9px;top:12px;bottom:12px;width:10px;background:rgba(0,0,0,.4);border-radius:6px;overflow:hidden;box-shadow:inset 0 0 0 1.5px rgba(150,190,140,.4)}
  .df{position:absolute;left:0;right:0;top:0;background:linear-gradient(#a8c69a,#4a6b3f);border-radius:6px;transition:height .2s}
  .dl{position:absolute;right:24px;top:12px;font-family:var(--serif);font-size:13px;color:#a8c69a;text-shadow:0 1px 3px #000}
  .banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(14,19,16,.72);backdrop-filter:blur(3px);text-align:center;pointer-events:auto;transition:opacity .4s;padding:22px}
  .banner h2{font-family:var(--serif);font-size:clamp(24px,6vw,40px);letter-spacing:.1em;margin:0 0 8px;color:#a8c69a}
  .banner p{font-size:14px;color:#9ab08e;margin:0 0 20px;max-width:30ch;line-height:1.7}
  .banner.hide{opacity:0;pointer-events:none}
  .btn{font-family:var(--serif);font-size:18px;letter-spacing:.12em;color:#0e1310;background:linear-gradient(120deg,#a8c69a,#6b9450);border:0;border-radius:30px;padding:12px 34px;cursor:pointer;box-shadow:0 10px 24px -8px rgba(120,180,90,.6)}
  .load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--serif);letter-spacing:.2em;color:#9ab08e;background:#0e1712;z-index:5}
  .touch{position:absolute;inset:0;pointer-events:none;display:none}
  .tb{position:absolute;bottom:16px;width:54px;height:54px;border-radius:50%;background:rgba(30,40,30,.7);border:2px solid #4a6b3f;display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:18px;color:#a8c69a;pointer-events:auto;user-select:none;-webkit-user-select:none}
  .tL{left:14px}.tR{left:76px}.tA{right:138px;background:rgba(70,50,30,.75)}.tU{right:76px}.tD{right:14px}
  @media (hover:none){.touch{display:block}.keys{display:none}}
  .keys{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
  .key{font-family:var(--mono);font-size:12px;color:#9ab08e;background:#1a221a;border:1.5px solid #2e3a2c;border-radius:8px;padding:5px 10px}
  .key b{color:#a8c69a;font-family:var(--serif)}
  .note{color:#6f8a66;font-size:12.5px;margin-top:12px;max-width:60ch;text-align:center;line-height:1.6}
</style>
<h1>方案A · 落水 → 潜水下沉</h1>
<div class="sub">splash · dive · 真井壁 + 黄泉浊水</div>
<div class="frame">
  <canvas id="g" width="460" height="760"></canvas>
  <div class="hud"><div class="dl" id="dl">井口</div><div class="depth"><div class="df" id="df" style="height:0%"></div></div></div>
  <div class="touch">
    <div class="tb tL" data-k="left">◀</div><div class="tb tR" data-k="right">▶</div>
    <div class="tb tA" data-k="atk">砸</div><div class="tb tU" data-k="up">浮</div><div class="tb tD" data-k="down">潜 ▼</div>
  </div>
  <div class="banner" id="banner"><h2>投井 · 落水</h2>
    <p>从井口纵身落下，<b style="color:#cfe0c2">砸破水面</b>沉入黄泉浊水。<br><b style="color:#a8c69a">按住 ▼ 下潜</b>，空格/▲ 上浮，A/D 摆动。</p>
    <button class="btn" id="startBtn">落井</button></div>
  <div class="load" id="load">载入井壁…</div>
</div>
<div class="keys">
  <span class="key"><b>A/D</b> 摆动</span><span class="key"><b>S/▼</b> 下潜</span><span class="key"><b>空格/▲</b> 上浮</span>
</div>
<p class="note">方案A：空中落下→砸破水面→水下浮力阻尼潜行。背景用真井壁图，水面以下叠黄泉浊水（越深越浑），透过浑水能看见井壁。</p>
<script>
const A={mid:"__MID__",welltop:"__WELLTOP__",ledge:"__LEDGE__"};
const cv=document.getElementById('g'),ctx=cv.getContext('2d');
const W=460,H=760,DPR=Math.min(devicePixelRatio||1,2);
cv.width=W*DPR;cv.height=H*DPR;ctx.scale(DPR,DPR);
const SURFACE=2200,GOAL=5800;
const LEDGE={y:SURFACE-62,L:-14,R:178},PASSAGE_X=26;   // 水面上方左台 + 左通道
const IMG={};let need=0,got=0;
function ld(k,src,fn){need++;const im=new Image();im.onload=()=>{IMG[k]=fn?fn(im):im;if(++got===need)ready();};im.onerror=()=>{if(++got===need)ready();};im.src=src;}
function makeFaded(img){const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
  const x=c.getContext('2d');x.drawImage(img,0,0);const fh=c.height*0.42;
  const g=x.createLinearGradient(0,0,0,c.height);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop((c.height-fh)/c.height,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');
  x.globalCompositeOperation='destination-in';x.fillStyle=g;x.fillRect(0,0,c.width,c.height);return c;}
ld('mid',A.mid);ld('welltop',A.welltop,makeFaded);ld('ledgeimg',A.ledge);

function bgTile(img,par){if(!img)return;const off=camY*par;const dw=W,dh=dw*img.height/img.width;
  const i0=Math.floor(off/dh);for(let i=i0;i*dh<off+H+dh;i++){const sy=i*dh-off;
    if(i&1){ctx.save();ctx.translate(0,sy+dh);ctx.scale(1,-1);ctx.drawImage(img,0,0,dw,dh);ctx.restore();}else ctx.drawImage(img,0,sy,dw,dh);}}

const keys={left:0,right:0,up:0,down:0};
let p,camY,bubbles,silt,ripples,state,splashDone,depthMax,rockHP,rockBroken,debris;
function reset(){
  p={x:W/2,y:-40,vx:0,vy:0,inWater:false,onGround:false,dir:1,atk:0,ph:0};
  camY=-140;bubbles=[];silt=[];ripples=[];splashDone=false;depthMax=0;
  rockHP=5;rockBroken=false;debris=[];
  for(let i=0;i<60;i++)silt.push({x:Math.random()*W,wy:SURFACE+Math.random()*H*3,ph:Math.random()*6.28,sp:.2+Math.random()*.5,r:.5+Math.random()*1.6});
  updateHUD();
}
function press(k,v){if(k in keys)keys[k]=v;
  if(k==='up'&&v&&p){if(p.onGround){p.vy=-470;p.onGround=false;}else if(p.inWater){p.vy=Math.min(p.vy,-580);}}  // 跳/跃出水面
  if(k==='atk'&&v)attack();}
function attack(){if(!p||!p.onGround)return;p.atk=0.22;p.dir=-1;
  if(!rockBroken&&p.x<110){rockHP--;state.shake=8;
    for(let i=0;i<9;i++)debris.push({x:38+Math.random()*26,y:LEDGE.y-14-Math.random()*72,vx:40+Math.random()*150,vy:-60-Math.random()*170,life:.7,r:2+Math.random()*3.2});
    if(rockHP<=0)rockBroken=true;}}
addEventListener('keydown',e=>{if(e.repeat)return;const c=e.code;
  if(c==='KeyA'||c==='ArrowLeft')press('left',1);else if(c==='KeyD'||c==='ArrowRight')press('right',1);
  else if(c==='KeyS'||c==='ArrowDown'){press('down',1);e.preventDefault();}
  else if(c==='Space'||c==='KeyW'||c==='ArrowUp'){press('up',1);e.preventDefault();}
  else if(c==='KeyJ'||c==='KeyK')attack();});
addEventListener('keyup',e=>{const c=e.code;if(c==='KeyA'||c==='ArrowLeft')press('left',0);else if(c==='KeyD'||c==='ArrowRight')press('right',0);
  else if(c==='KeyS'||c==='ArrowDown')press('down',0);else if(c==='Space'||c==='KeyW'||c==='ArrowUp')press('up',0);});
document.querySelectorAll('.tb').forEach(b=>{const k=b.dataset.k;const on=e=>{e.preventDefault();press(k,1);},off=e=>{e.preventDefault();press(k,0);};
  b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointerleave',off);b.addEventListener('pointercancel',off);});
function splash(x,y){ripples.push({x,y,r:6,life:1});ripples.push({x,y,r:2,life:1.3});
  for(let i=0;i<28;i++){const a=-Math.PI/2+(Math.random()-.5)*2.6,s=90+Math.random()*230;bubbles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.7,r:1.5+Math.random()*3,air:1});}}
function bub(x,y,n,spread){for(let i=0;i<n;i++)bubbles.push({x:x+(Math.random()-.5)*spread,y,vx:(Math.random()-.5)*20,vy:-30-Math.random()*40,life:1.6,r:1+Math.random()*2.4});}

function enterPassage(){state.run=false;const b=document.getElementById('banner');
  b.querySelector('h2').textContent='侧道';
  b.querySelector('p').innerHTML='你踩上水面上方的石台，从左侧通道离开了井……<br>(通往别处 · 分支演示)';
  b.querySelector('.btn').textContent='重来';b.classList.remove('hide');}
function update(dt){
  state.t+=dt;p.ph+=dt*6;
  const mvx=(keys.right?1:0)-(keys.left?1:0);
  if(!p.inWater){
    if(p.onGround){                                    // 站在水面上方左台
      if(mvx)p.dir=mvx;
      p.x+=mvx*185*dt;p.y=LEDGE.y;
      const wallX=rockBroken?PASSAGE_X:58;
      if(p.x<=wallX){if(rockBroken){enterPassage();return;}else p.x=wallX;}  // 未破:被石堆挡住
      if(p.x>LEDGE.R+2){p.onGround=false;}              // 走出右缘 → 掉落
    } else {
      p.vy+=1200*dt;p.vy=Math.min(p.vy,900);p.x+=mvx*150*dt;p.y+=p.vy*dt;
      if(p.vy>0){const pf=p.y-p.vy*dt;if(pf<=LEDGE.y&&p.y>=LEDGE.y&&p.x>=LEDGE.L&&p.x<=LEDGE.R){p.y=LEDGE.y;p.vy=0;p.onGround=true;}}
      if(!p.onGround&&p.y>=SURFACE){p.inWater=true;splash(p.x,SURFACE);p.vy*=0.4;}
    }
  }
  else{const mvy=(keys.down?1:0)-(keys.up?1:0);
    p.vy+=120*dt;p.vy+=mvy*760*dt;p.vx+=mvx*520*dt;
    p.vx-=p.vx*3.4*dt;p.vy-=p.vy*2.6*dt;
    p.vy=Math.max(-640,Math.min(340,p.vy));p.vx=Math.max(-190,Math.min(190,p.vx));
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.x=Math.max(46,Math.min(W-46,p.x));
    if(p.y<SURFACE){p.inWater=false;ripples.push({x:p.x,y:SURFACE,r:6,life:0.8});}   // 跃出水面进入空中
    if((mvx||mvy)&&Math.random()<0.4)bub(p.x-Math.sign(p.vx||1)*6,p.y-6,1,8);
    if(Math.random()<0.02)bub(p.x,p.y,1,10);}
  const tgt=p.y-H*0.36;camY+=(tgt-camY)*Math.min(1,dt*5);if(camY<p.y-H*0.6)camY=p.y-H*0.6;
  depthMax=Math.max(depthMax,p.y);
  if(p.inWater&&Math.random()<0.5)bubbles.push({x:Math.random()*W,y:camY+H+10,vx:(Math.random()-.5)*10,vy:-30-Math.random()*36,life:3,r:1+Math.random()*2});
  for(const b of bubbles){b.life-=dt;b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.air)b.vy+=520*dt;else{b.vy-=6*dt;b.x+=Math.sin(state.t*3+b.y*0.05)*10*dt;}}
  bubbles=bubbles.filter(b=>b.life>0);
  for(const r of ripples){r.life-=dt*1.4;r.r+=160*dt;}ripples=ripples.filter(r=>r.life>0);
  for(const s of silt){s.wy+=s.sp*10*dt;s.ph+=dt;}
  if(p.atk>0)p.atk-=dt;if(state.shake>0)state.shake=Math.max(0,state.shake-dt*32);
  for(const d of debris){d.life-=dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.vy+=700*dt;}debris=debris.filter(d=>d.life>0);
  updateHUD();if(p.y>=GOAL)end();
}
function updateHUD(){document.getElementById('df').style.height=Math.max(0,Math.min(100,p.y/GOAL*100))+'%';
  document.getElementById('dl').textContent=!p.inWater?'落下':(p.y>GOAL*0.7?'黄泉深处':'浊水中');}
function waterCol(d){const t=Math.min(1,d),top=[70,84,60],bot=[12,20,15];return top.map((v,i)=>Math.round(v+(bot[i]-v)*t));}

function drawRockPile(ly,hp){
  const stones=[[16,-12,20],[42,-9,18],[24,-38,22],[48,-42,16],[12,-60,16],[36,-66,20],[22,-88,15],[48,-84,13]];
  for(const s of stones){ctx.fillStyle='#3a332a';ctx.beginPath();ctx.arc(s[0],ly+s[1],s[2],0,6.28);ctx.fill();
    ctx.fillStyle='#4b4234';ctx.beginPath();ctx.arc(s[0]-s[2]*0.32,ly+s[1]-s[2]*0.32,s[2]*0.58,0,6.28);ctx.fill();}
  const dmg=5-hp;ctx.strokeStyle='rgba(16,11,6,0.85)';ctx.lineWidth=2.2;
  for(let i=0;i<dmg;i++){ctx.beginPath();ctx.moveTo(18+i*5,ly-16);ctx.lineTo(30+i*7,ly-62);ctx.stroke();}
}
function render(){
  const cx=camY;
  ctx.save();if(state.shake>0)ctx.translate((Math.random()-.5)*state.shake,(Math.random()-.5)*state.shake);
  ctx.fillStyle='#0e1712';ctx.fillRect(-12,-12,W+24,H+24);
  bgTile(IMG.mid,1.0);                                  // 真井壁,竖向镜像平铺
  if(IMG.welltop){const img=IMG.welltop,dh=W*img.height/img.width,sy=-160-cx;if(sy<H&&sy+dh>0)ctx.drawImage(img,0,sy,W,dh);} // 井口
  // 水面上方左台(真素材) + 左侧可砸石堆 / 破洞
  if(IMG.ledgeimg){const ly=LEDGE.y-cx;if(ly>-120&&ly<H+40){
    const img=IMG.ledgeimg,w=192,h=w*img.height/img.width,sf=0.30;
    ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(LEDGE.L+w*0.48,ly+3,w*0.4,5,0,0,6.28);ctx.fill();
    ctx.drawImage(img,LEDGE.L,ly-sf*h,w,h);
    if(!rockBroken){drawRockPile(ly,rockHP);
      ctx.fillStyle='rgba(224,206,150,0.85)';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('砸开石堆',94,ly-104);}
    else{ctx.fillStyle='#060906';ctx.beginPath();ctx.ellipse(26,ly-32,42,40,0,0,6.28);ctx.fill();
      ctx.fillStyle='#33291d';for(const s of [[4,-4,11],[54,-8,9],[50,-62,8]]){ctx.beginPath();ctx.arc(s[0],ly+s[1],s[2],0,6.28);ctx.fill();}
      ctx.fillStyle='rgba(200,220,170,0.85)';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('← 进洞',64,ly-30);}
  }}
  const surfSy=SURFACE-cx;
  if(surfSy<H){                                         // 水体覆盖(透过浑水看见井壁)
    const yTop=Math.max(0,surfSy);
    const dTop=Math.max(0,(cx+yTop-SURFACE)/GOAL),dBot=(cx+H-SURFACE)/GOAL;
    const ct=waterCol(dTop),cb=waterCol(dBot);
    const g=ctx.createLinearGradient(0,yTop,0,H);
    g.addColorStop(0,`rgba(${ct[0]},${ct[1]},${ct[2]},0.68)`);g.addColorStop(1,`rgba(${cb[0]},${cb[1]},${cb[2]},0.95)`);
    ctx.fillStyle=g;ctx.fillRect(0,yTop,W,H-yTop);
    for(const s of silt){const sy=s.wy-cx;if(sy<surfSy||sy<-4||sy>H+4)continue;ctx.globalAlpha=0.15+0.2*(0.5+0.5*Math.sin(state.t*s.sp+s.ph));
      ctx.fillStyle='rgba(180,190,150,0.5)';ctx.beginPath();ctx.arc(s.x+Math.sin(state.t*s.sp+s.ph)*10,sy,s.r,0,6.28);ctx.fill();}
    ctx.globalAlpha=1;
  }
  if(surfSy>-4&&surfSy<H+4){ctx.strokeStyle='rgba(190,210,160,0.55)';ctx.lineWidth=2;ctx.beginPath();
    for(let x=0;x<=W;x+=12){const yy=surfSy+Math.sin(x*0.08+state.t*2)*3;if(x===0)ctx.moveTo(x,yy);else ctx.lineTo(x,yy);}ctx.stroke();
    const ag=ctx.createLinearGradient(0,surfSy-70,0,surfSy);ag.addColorStop(0,'rgba(120,140,90,0.10)');ag.addColorStop(1,'rgba(120,140,90,0)');
    ctx.fillStyle=ag;ctx.fillRect(0,Math.max(0,surfSy-70),W,Math.min(70,Math.max(0,surfSy)));}
  for(const r of ripples){const ry=r.y-cx;ctx.strokeStyle='rgba(210,225,180,'+Math.max(0,r.life*0.5)+')';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(r.x,ry,r.r,r.r*0.3,0,0,6.28);ctx.stroke();}
  const psx=p.x,psy=p.y-cx;ctx.save();ctx.translate(psx,psy);
  const tilt=p.inWater?Math.max(-0.5,Math.min(0.5,p.vx*0.004)):0;ctx.rotate(tilt);
  ctx.fillStyle='#0b110c';ctx.beginPath();ctx.moveTo(-9,-2);ctx.quadraticCurveTo(-13,-30,-6,-44);ctx.lineTo(6,-44);ctx.quadraticCurveTo(13,-30,9,-2);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.arc(0,-50,8,0,6.28);ctx.fill();
  const sw=Math.sin(p.ph)*0.4;ctx.strokeStyle='#0b110c';ctx.lineWidth=5;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(-6,-30);ctx.lineTo(-14,-30+sw*14);ctx.stroke();ctx.beginPath();ctx.moveTo(6,-30);ctx.lineTo(14,-30-sw*14);ctx.stroke();
  ctx.strokeStyle='#7fa06a';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-8,-6);ctx.quadraticCurveTo(-12,-30,-6,-42);ctx.stroke();ctx.restore();
  for(const b of bubbles){const by=b.y-cx;ctx.globalAlpha=Math.min(1,b.life*(b.air?1.6:0.7));ctx.fillStyle=b.air?'rgba(220,230,200,0.8)':'rgba(200,220,190,0.55)';
    ctx.beginPath();ctx.arc(b.x,by,b.r,0,6.28);ctx.fill();
    if(!b.air&&b.r>1.5){ctx.fillStyle='rgba(255,255,255,0.4)';ctx.beginPath();ctx.arc(b.x-b.r*0.3,by-b.r*0.3,b.r*0.35,0,6.28);ctx.fill();}}
  ctx.globalAlpha=1;
  for(const d of debris){ctx.globalAlpha=Math.max(0,d.life*1.6);ctx.fillStyle='#4a3d2a';ctx.beginPath();ctx.arc(d.x,d.y-cx,d.r,0,6.28);ctx.fill();}
  ctx.globalAlpha=1;
  const dv=Math.min(0.7,Math.max(0,(p.y-SURFACE)/GOAL*0.9));
  const vg=ctx.createRadialGradient(W/2,H*0.42,H*0.22,W/2,H*0.42,H*0.85);
  vg.addColorStop(0,'rgba(6,10,7,0)');vg.addColorStop(1,'rgba(6,10,7,'+(0.4+dv*0.5)+')');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
  ctx.restore();
}
let last=performance.now();
function loop(now){let dt=(now-last)/1000;last=now;dt=Math.min(dt,0.05);if(state.run)update(dt);render();requestAnimationFrame(loop);}
const banner=document.getElementById('banner');state={run:false,t:0};
function start(){reset();state={run:true,t:0};banner.classList.add('hide');}
function end(){state.run=false;banner.querySelector('h2').textContent='沉入黄泉';banner.querySelector('p').innerHTML='潜到井底黄泉深处 → 地府入口。<br>(方案A效果原型)';banner.querySelector('.btn').textContent='再落一次';banner.classList.remove('hide');}
document.getElementById('startBtn').addEventListener('click',start);
function ready(){document.getElementById('load').style.display='none';reset();requestAnimationFrame(loop);}
</script>"""
HTML=HTML.replace("__MID__",MID).replace("__WELLTOP__",WELLTOP).replace("__LEDGE__",LEDGEIMG)
open(os.path.join(SP,"underwater.html"),"w").write(HTML)
print("wrote underwater.html",round(len(HTML)/1024),"KB")
