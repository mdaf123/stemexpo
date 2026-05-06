// ============================================================
// GARDEN DEFENSE - Full 3D First-Person Tower Defense
// ============================================================

const canvas = document.getElementById('game-canvas');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
const rainCanvas = document.getElementById('rain-canvas');
const rainCtx = rainCanvas.getContext('2d');

// ---- Resize ----
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  rainCanvas.width = window.innerWidth;
  rainCanvas.height = window.innerHeight;
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// ============================================================
// MATH UTILS
// ============================================================
const DEG = Math.PI / 180;
function v3(x,y,z){return[x,y,z]}
function v3add(a,b){return[a[0]+b[0],a[1]+b[1],a[2]+b[2]]}
function v3sub(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
function v3scale(a,s){return[a[0]*s,a[1]*s,a[2]*s]}
function v3dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function v3len(a){return Math.sqrt(v3dot(a,a))}
function v3norm(a){const l=v3len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]}
function v3cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function dist2d(a,b){return Math.sqrt((a[0]-b[0])**2+(a[2]-b[2])**2)}

function mat4identity(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
function mat4mul(a,b){
  const r=new Float32Array(16);
  for(let i=0;i<4;i++)for(let j=0;j<4;j++){
    let s=0;for(let k=0;k<4;k++)s+=a[i*4+k]*b[k*4+j];r[i*4+j]=s;
  }
  return r;
}
function mat4perspective(fov,asp,near,far){
  const f=1/Math.tan(fov/2),nf=1/(near-far);
  return new Float32Array([f/asp,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);
}
function mat4lookAt(eye,center,up){
  const z=v3norm(v3sub(eye,center));
  const x=v3norm(v3cross(up,z));
  const y=v3cross(z,x);
  return new Float32Array([
    x[0],y[0],z[0],0,
    x[1],y[1],z[1],0,
    x[2],y[2],z[2],0,
    -v3dot(x,eye),-v3dot(y,eye),-v3dot(z,eye),1
  ]);
}
function mat4translate(x,y,z){
  const m=mat4identity();m[12]=x;m[13]=y;m[14]=z;return new Float32Array(m);
}
function mat4scale(x,y,z){
  const m=mat4identity();m[0]=x;m[5]=y;m[10]=z;return new Float32Array(m);
}
function mat4rotY(a){
  const c=Math.cos(a),s=Math.sin(a);
  return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]);
}

// ============================================================
// SHADERS
// ============================================================
const vsSource = `
attribute vec3 aPos;
attribute vec3 aNorm;
attribute vec2 aUV;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNorm;
varying vec3 vPos;
varying vec2 vUV;
void main(){
  vec4 world = uModel * vec4(aPos,1.0);
  vPos = world.xyz;
  vNorm = (uModel * vec4(aNorm,0.0)).xyz;
  vUV = aUV;
  gl_Position = uMVP * vec4(aPos,1.0);
}`;

const fsSource = `
precision mediump float;
varying vec3 vNorm;
varying vec3 vPos;
varying vec2 vUV;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uFogDist;
uniform vec3 uFogColor;
void main(){
  vec3 n = normalize(vNorm);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  vec3 lit = uColor * (uAmbient + diff * (1.0 - uAmbient));
  float fogF = clamp(length(vPos) / uFogDist, 0.0, 1.0);
  gl_FragColor = vec4(mix(lit, uFogColor, fogF * 0.5), 1.0);
}`;

function compileShader(type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
  return sh;
}
const prog = gl.createProgram();
gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSource));
gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(prog);
gl.useProgram(prog);

const aPos  = gl.getAttribLocation(prog,'aPos');
const aNorm = gl.getAttribLocation(prog,'aNorm');
const aUV   = gl.getAttribLocation(prog,'aUV');
const uMVP   = gl.getUniformLocation(prog,'uMVP');
const uModel = gl.getUniformLocation(prog,'uModel');
const uColor = gl.getUniformLocation(prog,'uColor');
const uLightDir = gl.getUniformLocation(prog,'uLightDir');
const uAmbient = gl.getUniformLocation(prog,'uAmbient');
const uFogDist = gl.getUniformLocation(prog,'uFogDist');
const uFogColor = gl.getUniformLocation(prog,'uFogColor');

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);

// ============================================================
// MESH FACTORY
// ============================================================
function makeCubeMesh(w,h,d){
  const hw=w/2,hh=h/2,hd=d/2;
  const pos=[
    -hw,-hh,-hd, hw,-hh,-hd, hw,hh,-hd,-hw,hh,-hd,
    -hw,-hh, hd, hw,-hh, hd, hw,hh, hd,-hw,hh, hd,
    -hw,-hh,-hd,-hw,hh,-hd,-hw,hh, hd,-hw,-hh, hd,
     hw,-hh,-hd, hw,hh,-hd, hw,hh, hd, hw,-hh, hd,
    -hw,hh,-hd,  hw,hh,-hd,  hw,hh, hd,-hw,hh, hd,
    -hw,-hh,-hd, hw,-hh,-hd, hw,-hh, hd,-hw,-hh, hd
  ];
  const norms=[
    0,0,-1,0,0,-1,0,0,-1,0,0,-1,
    0,0,1,0,0,1,0,0,1,0,0,1,
    -1,0,0,-1,0,0,-1,0,0,-1,0,0,
    1,0,0,1,0,0,1,0,0,1,0,0,
    0,1,0,0,1,0,0,1,0,0,1,0,
    0,-1,0,0,-1,0,0,-1,0,0,-1,0
  ];
  const idx=[];
  for(let f=0;f<6;f++){const b=f*4;idx.push(b,b+1,b+2,b,b+2,b+3);}
  return createMesh(new Float32Array(pos),new Float32Array(norms),new Uint16Array(idx));
}

function makeCylinderMesh(r,h,segs){
  const pos=[],norms=[],idx=[];
  for(let i=0;i<=segs;i++){
    const a=i/segs*Math.PI*2;
    const x=Math.cos(a)*r,z=Math.sin(a)*r;
    pos.push(x,0,z,x,h,z);
    norms.push(x/r,0,z/r,x/r,0,z/r);
  }
  for(let i=0;i<segs;i++){
    const b=i*2;
    idx.push(b,b+1,b+2,b+1,b+3,b+2);
  }
  return createMesh(new Float32Array(pos),new Float32Array(norms),new Uint16Array(idx));
}

function makeConeMesh(r,h,segs){
  const pos=[0,h,0],norms=[0,1,0],idx=[];
  for(let i=0;i<=segs;i++){
    const a=i/segs*Math.PI*2;
    pos.push(Math.cos(a)*r,0,Math.sin(a)*r);
    norms.push(Math.cos(a),0.5,Math.sin(a));
  }
  for(let i=0;i<segs;i++) idx.push(0,i+1,i+2);
  return createMesh(new Float32Array(pos),new Float32Array(norms),new Uint16Array(idx));
}

function createMesh(positions,normals,indices){
  const pb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pb);gl.bufferData(gl.ARRAY_BUFFER,positions,gl.STATIC_DRAW);
  const nb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,nb);gl.bufferData(gl.ARRAY_BUFFER,normals,gl.STATIC_DRAW);
  const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
  return{pb,nb,ib,count:indices.length};
}

const meshes = {
  cube1: makeCubeMesh(1,1,1),
  cube0_3: makeCubeMesh(0.3,0.3,0.3),
  soil: makeCubeMesh(1.2,0.1,1.2),
  stalk: makeCylinderMesh(0.05,0.6,8),
  trunk: makeCylinderMesh(0.08,1.2,8),
  ball: makeConeMesh(0.4,0.8,12),
  enemy: makeCubeMesh(0.4,0.3,0.6),
  slug: makeCylinderMesh(0.18,0.15,10),
  projectile: makeConeMesh(0.08,0.2,6),
  fence: makeCubeMesh(0.08,0.8,8),
  cactus: makeCylinderMesh(0.12,0.9,8),
  sunHead: makeConeMesh(0.5,0.5,16),
  rose: makeCubeMesh(0.5,1.0,0.5),
};

// ============================================================
// DRAW MESH
// ============================================================
function drawMesh(mesh,mvp,model,color){
  gl.bindBuffer(gl.ARRAY_BUFFER,mesh.pb);
  gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
  gl.enableVertexAttribArray(aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER,mesh.nb);
  gl.vertexAttribPointer(aNorm,3,gl.FLOAT,false,0,0);
  gl.enableVertexAttribArray(aNorm);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.ib);
  gl.uniformMatrix4fv(uMVP,false,mvp);
  gl.uniformMatrix4fv(uModel,false,model||mat4identity());
  gl.uniform3fv(uColor,color);
  gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);
}

function getMVP(view,proj,model){
  return mat4mul(mat4mul(proj,view),new Float32Array(model));
}

// ============================================================
// GAME STATE
// ============================================================
const FARM_COLS = 5, FARM_ROWS = 5;
const CELL_SIZE = 3.5;
const FARM_ORIGIN = [-(FARM_COLS*CELL_SIZE)/2, 0, -(FARM_ROWS*CELL_SIZE)/2];

const CROP_TYPES = {
  carrot:  {icon:'🥕', growTime:20, sellValue:12, seedCost:5,  color:[0.9,0.45,0.1]},
  wheat:   {icon:'🌾', growTime:35, sellValue:20, seedCost:8,  color:[0.9,0.8,0.2]},
  pumpkin: {icon:'🎃', growTime:60, sellValue:40, seedCost:15, color:[0.9,0.5,0.1]},
};
const TOWER_TYPES = {
  cactus:    {icon:'🌵', cost:30, dmg:8,  range:5,  rate:1.5, color:[0.2,0.7,0.2], targets:['slug','snail','rabbit']},
  sunflower: {icon:'🌻', cost:50, dmg:5,  range:7,  rate:1.0, color:[0.95,0.8,0.1], targets:['crow','thief','rabbit']},
  rosebush:  {icon:'🌹', cost:70, dmg:15, range:4,  rate:2.0, color:[0.85,0.15,0.25], targets:['slug','snail','rabbit','crow','thief']},
};

let state = {};

function initState(){
  state = {
    money: 50,
    saltCount: 10,
    day: 1,
    wave: 1,
    dayTimer: 0,
    dayLength: 90,   // seconds
    gameOver: false,
    cropCells: [],   // {col,row,type,growth,stage,hp}
    towers: [],      // {col,row,type,level,cooldown,hp}
    enemies: [],     // {type,pos,hp,maxHp,speed,target,stunned}
    projectiles: [], // {pos,vel,dmg,life}
    particles: [],   // {pos,vel,life,color}
    weather: 'clear', // clear|drought|tornado
    weatherTimer: 0,
    waveEnemies: 0,
    waveSpawnTimer: 0,
    waveCooldown: 10,
    waveActive: false,
    seeds: {carrot:3, wheat:2, pumpkin:0},
    harvestable: 0,
    selectedTool: null,
  };
  buildFarmGrid();
}

function buildFarmGrid(){
  state.farmGrid = [];
  for(let r=0;r<FARM_ROWS;r++)
    for(let c=0;c<FARM_COLS;c++)
      state.farmGrid.push({col:c,row:r,hasCrop:false,hasTower:false});
}

function cellPos(col,row){
  return [
    FARM_ORIGIN[0] + col*CELL_SIZE + CELL_SIZE/2,
    0,
    FARM_ORIGIN[2] + row*CELL_SIZE + CELL_SIZE/2
  ];
}

// ============================================================
// PLAYER
// ============================================================
const player = {
  pos: [0, 1.7, 8],
  yaw: 0,
  pitch: 0,
  vel: [0,0,0],
  speed: 5,
};
const keys = {};

document.addEventListener('keydown', e=>{
  keys[e.code]=true;
  if(!state.gameOver){
    if(e.code==='KeyB') toggleShop();
    if(e.code==='Digit1') selectTool('salt');
    if(e.code==='Digit2') selectTool('seed-carrot');
    if(e.code==='Digit3') selectTool('seed-wheat');
    if(e.code==='Digit4') selectTool('seed-pumpkin');
    if(e.code==='Digit5') selectTool('tower-cactus');
    if(e.code==='Digit6') selectTool('tower-sunflower');
    if(e.code==='KeyE') tryInteract();
    if(e.code==='Escape'){state.selectedTool=null;updateToolbar();}
  }
});
document.addEventListener('keyup', e=>{ keys[e.code]=false; });

// Pointer lock
canvas.addEventListener('click',()=>{
  if(!document.pointerLockElement) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange',()=>{});
document.addEventListener('mousemove',e=>{
  if(document.pointerLockElement===canvas){
    player.yaw   += e.movementX * 0.002;
    player.pitch  = Math.max(-1.2, Math.min(1.2, player.pitch - e.movementY * 0.002));
  }
});
document.addEventListener('mousedown',e=>{
  if(e.button===0 && document.pointerLockElement===canvas) useTool();
});

// ============================================================
// TOOLS / SHOP
// ============================================================
function selectTool(t){
  state.selectedTool = t;
  updateToolbar();
}
function updateToolbar(){
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>{
    b.classList.toggle('active', b.dataset.tool===state.selectedTool);
  });
}
document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>{
  b.addEventListener('click',()=>selectTool(b.dataset.tool));
});
document.getElementById('shop-toggle-btn').addEventListener('click',toggleShop);

function toggleShop(){
  const p=document.getElementById('shop-panel');
  p.style.display = p.style.display==='block'?'none':'block';
}
document.querySelectorAll('.shop-item').forEach(el=>{
  el.addEventListener('click',()=>buyItem(el.dataset.buy));
});

function buyItem(item){
  const costs={
    'salt':10, 'seed-carrot-bulk':12,'seed-wheat-bulk':20,'seed-pumpkin-bulk':25,
    'tower-cactus':30,'tower-sunflower':50,'tower-rosebush':70,'upgrade-tower':60
  };
  const cost=costs[item];
  if(state.money<cost){notify('Not enough money!','danger');return;}
  state.money-=cost;
  if(item==='salt') state.saltCount+=5;
  else if(item==='seed-carrot-bulk'){state.seeds.carrot+=3;}
  else if(item==='seed-wheat-bulk'){state.seeds.wheat+=3;}
  else if(item==='seed-pumpkin-bulk'){state.seeds.pumpkin+=2;}
  else if(item==='tower-cactus'){selectTool('tower-cactus');notify('Cactus tower ready to place!','success');}
  else if(item==='tower-sunflower'){selectTool('tower-sunflower');notify('Sunflower tower ready to place!','success');}
  else if(item==='tower-rosebush'){selectTool('tower-rosebush');notify('Rose Bush ready to place!','success');}
  else if(item==='upgrade-tower') upgradeTower();
  updateHUD();
  notify(`Bought: ${item}`,'success');
}

function upgradeTower(){
  if(state.towers.length===0){notify('No towers to upgrade!','danger');return;}
  // find nearest tower to player
  let best=null,bd=999;
  state.towers.forEach(t=>{
    const d=dist2d(player.pos,cellPos(t.col,t.row));
    if(d<bd){bd=d;best=t;}
  });
  if(best&&best.level<3){
    best.level++;
    best.type_data = Object.assign({},TOWER_TYPES[best.type]);
    best.type_data.dmg *= best.level;
    best.type_data.range *= 1+best.level*0.2;
    notify(`Tower upgraded to level ${best.level}!`,'success');
  } else notify('Tower already max level or none nearby','danger');
}

function useTool(){
  const tool=state.selectedTool;
  if(!tool) return;
  const hit=raycastFarm();
  if(tool==='salt'){
    // pour salt on nearest enemy
    const saltKilled=pourSalt();
    if(!saltKilled && hit){} // nothing
    return;
  }
  if(tool.startsWith('seed-')){
    if(!hit){notify('Aim at a soil patch!','danger');return;}
    const {col,row}=hit;
    const cell=getFarmCell(col,row);
    if(cell.hasCrop){notify('Crop already here!','danger');return;}
    if(cell.hasTower){notify('Tower is here!','danger');return;}
    const type=tool.replace('seed-','');
    if(state.seeds[type]<=0){notify(`No ${type} seeds left!`,'danger');return;}
    const ct=CROP_TYPES[type];
    state.seeds[type]--;
    cell.hasCrop=true;
    state.cropCells.push({col,row,type,growth:0,stage:0,hp:3});
    notify(`Planted ${ct.icon} ${type}!`,'success');
    updateHUD();
    return;
  }
  if(tool.startsWith('tower-')){
    if(!hit){notify('Aim at a soil patch!','danger');return;}
    const {col,row}=hit;
    const cell=getFarmCell(col,row);
    if(cell.hasCrop){notify('Crop is growing here!','danger');return;}
    if(cell.hasTower){notify('Tower already here!','danger');return;}
    const type=tool.replace('tower-','');
    const tt=TOWER_TYPES[type];
    if(!tt){notify('Unknown tower!','danger');return;}
    if(state.money<tt.cost){notify('Not enough money!','danger');return;}
    state.money-=tt.cost;
    cell.hasTower=true;
    state.towers.push({col,row,type,level:1,cooldown:0,hp:10,maxHp:10,type_data:Object.assign({},tt)});
    state.selectedTool=null;
    updateToolbar();
    notify(`${tt.icon} tower planted!`,'success');
    updateHUD();
    return;
  }
}

function pourSalt(){
  if(state.saltCount<=0){notify('Out of salt! Buy more in the shop.','danger');return false;}
  // check nearby slugs/snails
  let killed=false;
  state.enemies = state.enemies.filter(e=>{
    if((e.type==='slug'||e.type==='snail')&&dist2d(e.pos,player.pos)<3){
      killed=true;
      spawnParticles(e.pos,[1,1,0.8]);
      notify(`💀 ${e.type} killed with salt!`,'success');
      return false;
    }
    return true;
  });
  if(killed){state.saltCount--;updateHUD();}
  else notify('No slugs or snails nearby!','danger');
  return killed;
}

function raycastFarm(){
  // simple ray from player facing dir, find intersecting farm cell
  const dir = getFacingDir();
  for(let t=0.5;t<10;t+=0.25){
    const p=[player.pos[0]+dir[0]*t, player.pos[1]+dir[1]*t-1.7, player.pos[2]+dir[2]*t];
    // check each cell
    for(let r=0;r<FARM_ROWS;r++){
      for(let c=0;c<FARM_COLS;c++){
        const cp=cellPos(c,r);
        const hs=CELL_SIZE/2;
        if(Math.abs(p[0]-cp[0])<hs&&Math.abs(p[2]-cp[2])<hs&&p[1]>-0.2&&p[1]<0.3){
          return{col:c,row:r};
        }
      }
    }
  }
  return null;
}

function getFacingDir(){
  return [
    Math.sin(player.yaw)*Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(player.yaw)*Math.cos(player.pitch)
  ];
}

function tryInteract(){
  // harvest nearest ripe crop
  let best=null,bd=4;
  state.cropCells.forEach(c=>{
    if(c.stage===2){
      const d=dist2d(player.pos,cellPos(c.col,c.row));
      if(d<bd){bd=d;best=c;}
    }
  });
  if(best){
    const ct=CROP_TYPES[best.type];
    const val = ct.sellValue*(1+(best.type==='pumpkin'?0.5:0));
    state.money+=val;
    notify(`Harvested ${ct.icon} for $${val}!`,'success');
    spawnParticles(cellPos(best.col,best.row),ct.color);
    const cell=getFarmCell(best.col,best.row);
    cell.hasCrop=false;
    state.cropCells=state.cropCells.filter(c=>c!==best);
    updateHUD();
  } else {
    notify('Nothing to harvest nearby (aim closer to a ripe crop)','danger');
  }
}

function getFarmCell(col,row){
  return state.farmGrid.find(c=>c.col===col&&c.row===row);
}

// ============================================================
// UPDATE PLAYER
// ============================================================
function updatePlayer(dt){
  const spd = state.weather==='tornado'?2.5:player.speed;
  const cos=Math.cos(player.yaw), sin=Math.sin(player.yaw);
  let dx=0,dz=0;
  if(keys['KeyW']){dx+=sin;dz-=cos;}
  if(keys['KeyS']){dx-=sin;dz+=cos;}
  if(keys['KeyA']){dx-=cos;dz-=sin;}
  if(keys['KeyD']){dx+=cos;dz+=sin;}
  const len=Math.sqrt(dx*dx+dz*dz);
  if(len>0){dx/=len;dz/=len;}
  player.pos[0]+=dx*spd*dt;
  player.pos[2]+=dz*spd*dt;
  // boundary
  const bound=FARM_COLS*CELL_SIZE/2+6;
  player.pos[0]=Math.max(-bound,Math.min(bound,player.pos[0]));
  player.pos[2]=Math.max(-bound,Math.min(bound,player.pos[2]));
  player.pos[1]=1.7;

  // interact hint
  let nearRipe=state.cropCells.some(c=>c.stage===2&&dist2d(player.pos,cellPos(c.col,c.row))<4);
  document.getElementById('interact-hint').classList.toggle('visible',nearRipe);
}

// ============================================================
// ENEMIES
// ============================================================
const ENEMY_TYPES = {
  slug:   {hp:20,  speed:0.5, dmg:0.5, color:[0.5,0.7,0.3], icon:'🐌', size:0.3},
  snail:  {hp:30,  speed:0.4, dmg:0.5, color:[0.6,0.6,0.4], icon:'🐌', size:0.35},
  rabbit: {hp:15,  speed:1.8, dmg:1.0, color:[0.8,0.7,0.65],icon:'🐇', size:0.4},
  crow:   {hp:12,  speed:2.5, dmg:0.8, color:[0.2,0.2,0.2], icon:'🐦', size:0.35},
  thief:  {hp:40,  speed:1.2, dmg:2.0, color:[0.3,0.15,0.05],icon:'🕵️', size:0.5},
};

function spawnEnemy(type){
  const et=ENEMY_TYPES[type];
  // spawn from random edge
  const edge=Math.floor(Math.random()*4);
  const hs=FARM_COLS*CELL_SIZE/2+4;
  let pos;
  if(edge===0) pos=[-hs+Math.random()*hs*2,0.2,-hs];
  else if(edge===1) pos=[-hs+Math.random()*hs*2,0.2,hs];
  else if(edge===2) pos=[-hs,0.2,-hs+Math.random()*hs*2];
  else              pos=[hs,0.2,-hs+Math.random()*hs*2];
  state.enemies.push({
    type,pos,hp:et.hp*(1+state.wave*0.15),maxHp:et.hp*(1+state.wave*0.15),
    speed:et.speed*(1+state.wave*0.05),dmg:et.dmg,
    target:null,color:et.color,stunned:0,size:et.size
  });
}

function updateEnemies(dt){
  state.enemies.forEach(e=>{
    if(e.stunned>0){e.stunned-=dt;return;}
    // find target crop
    let best=null,bd=999;
    state.cropCells.forEach(c=>{
      const d=dist2d(e.pos,cellPos(c.col,c.row));
      if(d<bd){bd=d;best=c;}
    });
    e.target=best;
    if(best){
      const tp=cellPos(best.col,best.row);
      const dir=v3norm(v3sub(tp,e.pos));
      e.pos[0]+=dir[0]*e.speed*dt;
      e.pos[2]+=dir[2]*e.speed*dt;
      if(bd<0.8){
        best.hp-=e.dmg*dt;
        if(best.hp<=0){
          notify(`${ENEMY_TYPES[e.type].icon} destroyed a ${CROP_TYPES[best.type].icon} crop!`,'danger');
          spawnParticles(cellPos(best.col,best.row),[0.8,0.2,0.1]);
          getFarmCell(best.col,best.row).hasCrop=false;
          state.cropCells=state.cropCells.filter(c=>c!==best);
        }
      }
    } else {
      // wander towards farm center
      const center=[0,0.2,0];
      const dir=v3norm(v3sub(center,e.pos));
      e.pos[0]+=dir[0]*e.speed*0.5*dt;
      e.pos[2]+=dir[2]*e.speed*0.5*dt;
    }
  });
}

// ============================================================
// TOWERS
// ============================================================
function updateTowers(dt){
  state.towers.forEach(tower=>{
    tower.cooldown-=dt;
    if(tower.cooldown>0) return;
    const tt=tower.type_data;
    const tp=cellPos(tower.col,tower.row);
    // find nearest valid enemy
    let best=null,bd=tt.range;
    state.enemies.forEach(e=>{
      if(!tt.targets.includes(e.type)) return;
      const d=dist2d(tp,e.pos);
      if(d<bd){bd=d;best=e;}
    });
    if(best){
      tower.cooldown=1/tt.rate;
      // fire projectile
      const dir=v3norm(v3sub(best.pos,[tp[0],tp[1]+0.8,tp[2]]));
      state.projectiles.push({
        pos:[tp[0],tp[1]+0.8,tp[2]],
        vel:[dir[0]*8,dir[1]*8,dir[2]*8],
        dmg:tt.dmg,life:2,target:best,
        color:tt.color
      });
    }
  });
}

function updateProjectiles(dt){
  state.projectiles=state.projectiles.filter(p=>{
    p.pos[0]+=p.vel[0]*dt;
    p.pos[1]+=p.vel[1]*dt;
    p.pos[2]+=p.vel[2]*dt;
    p.life-=dt;
    if(p.life<0) return false;
    // hit check
    for(let i=state.enemies.length-1;i>=0;i--){
      const e=state.enemies[i];
      if(dist2d(p.pos,e.pos)<0.6&&Math.abs(p.pos[1]-e.pos[1])<0.8){
        e.hp-=p.dmg;
        spawnParticles(e.pos,[1,0.8,0.2]);
        if(e.hp<=0){
          state.enemies.splice(i,1);
          state.money+=3;
          updateHUD();
        }
        return false;
      }
    }
    return true;
  });
}

// ============================================================
// CROPS
// ============================================================
function updateCrops(dt){
  const droughtFactor = state.weather==='drought' ? 0.3 : 1;
  state.cropCells.forEach(c=>{
    const ct=CROP_TYPES[c.type];
    c.growth += (dt/ct.growTime)*droughtFactor;
    c.stage = c.growth<0.5 ? 0 : c.growth<1 ? 1 : 2;
  });
}

// ============================================================
// PARTICLES
// ============================================================
function spawnParticles(pos,color){
  for(let i=0;i<6;i++){
    state.particles.push({
      pos:[...pos],
      vel:[(Math.random()-0.5)*3,(Math.random()*2+1),(Math.random()-0.5)*3],
      life:1+Math.random()*0.5,
      maxLife:1.5,
      color
    });
  }
}

function updateParticles(dt){
  state.particles=state.particles.filter(p=>{
    p.pos[0]+=p.vel[0]*dt; p.pos[1]+=p.vel[1]*dt; p.pos[2]+=p.vel[2]*dt;
    p.vel[1]-=5*dt;
    p.life-=dt;
    return p.life>0;
  });
}

// ============================================================
// WAVES
// ============================================================
function updateWaves(dt){
  if(!state.waveActive){
    state.waveCooldown-=dt;
    if(state.waveCooldown<=0){
      startWave();
    }
    return;
  }
  state.waveSpawnTimer-=dt;
  if(state.waveSpawnTimer<=0&&state.waveEnemies>0){
    state.waveSpawnTimer=1.5-Math.min(1,state.wave*0.05);
    const types=['slug','snail','rabbit','crow','thief'];
    const available=types.slice(0,Math.min(types.length,Math.ceil(state.wave/2)));
    spawnEnemy(available[Math.floor(Math.random()*available.length)]);
    state.waveEnemies--;
  }
  if(state.waveEnemies<=0&&state.enemies.length===0){
    state.waveActive=false;
    state.wave++;
    state.waveCooldown=12;
    notify(`🌊 Wave ${state.wave-1} cleared! Wave ${state.wave} coming...`,'success');
    // bonus money per wave
    state.money+=10+state.wave*3;
    updateHUD();
  }
}

function startWave(){
  state.waveActive=true;
  const count=3+state.wave*2;
  state.waveEnemies=count;
  state.waveSpawnTimer=0;
  notify(`⚠️ Wave ${state.wave} incoming! (${count} enemies)`,'danger');
}

// ============================================================
// WEATHER
// ============================================================
function updateWeather(dt){
  if(state.weather!=='clear'){
    state.weatherTimer-=dt;
    if(state.weatherTimer<=0) endWeather();
    return;
  }
  // random weather chance
  if(Math.random()<0.0005*dt*60){
    triggerWeather(Math.random()<0.5?'drought':'tornado');
  }
}

function triggerWeather(type){
  state.weather=type;
  state.weatherTimer=type==='drought'?25:12;
  const overlay=document.getElementById('weather-overlay');
  overlay.className=type;
  if(type==='drought'){
    notify('☀️ DROUGHT! Crops grow slower for 25 seconds!','weather');
    document.getElementById('rain-canvas').classList.remove('active');
  } else {
    notify('🌪️ TORNADO! Movement slowed, some crops damaged!','weather');
    document.getElementById('rain-canvas').classList.add('active');
    // damage random crops
    const shuffle=[...state.cropCells].sort(()=>Math.random()-0.5);
    shuffle.slice(0,Math.ceil(shuffle.length*0.4)).forEach(c=>{
      c.hp-=2;
      if(c.hp<=0){
        notify(`🌪️ Tornado destroyed a ${CROP_TYPES[c.type].icon} crop!`,'danger');
        getFarmCell(c.col,c.row).hasCrop=false;
      }
    });
    state.cropCells=state.cropCells.filter(c=>c.hp>0);
  }
}

function endWeather(){
  state.weather='clear';
  const overlay=document.getElementById('weather-overlay');
  overlay.className='';
  document.getElementById('rain-canvas').classList.remove('active');
  notify('Weather passed. Back to farming!','success');
}

// ============================================================
// RAIN ANIMATION
// ============================================================
const rainDrops=[];
for(let i=0;i<150;i++) rainDrops.push({x:Math.random(),y:Math.random(),speed:Math.random()*0.3+0.2});
function drawRain(){
  if(state.weather!=='tornado') return;
  rainCtx.clearRect(0,0,rainCanvas.width,rainCanvas.height);
  rainCtx.strokeStyle='rgba(150,180,255,0.5)';
  rainCtx.lineWidth=1.5;
  rainDrops.forEach(d=>{
    d.y+=d.speed*0.016;
    d.x+=0.002;
    if(d.y>1){d.y=0;d.x=Math.random();}
    const x=d.x*rainCanvas.width, y=d.y*rainCanvas.height;
    rainCtx.beginPath();
    rainCtx.moveTo(x,y);
    rainCtx.lineTo(x+8,y+15);
    rainCtx.stroke();
  });
}

// ============================================================
// DAY CYCLE
// ============================================================
function updateDay(dt){
  state.dayTimer+=dt;
  if(state.dayTimer>=state.dayLength){
    state.dayTimer=0;
    state.day++;
    updateHUD();
  }
}

// ============================================================
// GAME OVER CHECK
// ============================================================
function checkGameOver(){
  const hasCrops=state.cropCells.length>0||Object.values(state.seeds).some(v=>v>0);
  const hasMoney=state.money>0;
  if(!hasCrops&&!hasMoney&&state.enemies.length>0){
    triggerGameOver();
  }
}

function triggerGameOver(){
  state.gameOver=true;
  document.getElementById('game-over').style.display='flex';
  document.getElementById('go-score').textContent=`Day ${state.day} — Wave ${state.wave}`;
  if(document.pointerLockElement) document.exitPointerLock();
}

// ============================================================
// HUD UPDATE
// ============================================================
function updateHUD(){
  document.getElementById('hud-money').textContent='$'+state.money;
  document.getElementById('hud-crops').textContent=state.cropCells.length;
  document.getElementById('hud-salt').textContent=state.saltCount;
  document.getElementById('hud-day').textContent=state.day;
  document.getElementById('hud-wave').textContent=state.wave;
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function notify(msg,type=''){
  const cont=document.getElementById('notifications');
  const el=document.createElement('div');
  el.className='notif '+(type||'');
  el.textContent=msg;
  cont.appendChild(el);
  setTimeout(()=>el.remove(),3000);
}

// ============================================================
// RENDERING
// ============================================================
function getViewMatrix(){
  const eye=[...player.pos];
  const dir=getFacingDir();
  const center=[eye[0]+dir[0],eye[1]+dir[1],eye[2]+dir[2]];
  return mat4lookAt(eye,center,[0,1,0]);
}

function getProjMatrix(){
  return mat4perspective(70*DEG, canvas.width/canvas.height, 0.1, 80);
}

function render(){
  const view=getViewMatrix();
  const proj=getProjMatrix();

  // sky color based on time/weather
  let sky=[0.53,0.81,0.92];
  if(state.weather==='drought') sky=[0.7,0.55,0.2];
  else if(state.weather==='tornado') sky=[0.3,0.3,0.4];
  const dayT=(state.dayTimer/state.dayLength);
  const nightFactor=Math.max(0,Math.abs(dayT-0.5)*2-0.3);
  sky=sky.map(c=>c*(1-nightFactor*0.6));

  gl.clearColor(...sky,1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

  // light
  gl.uniform3fv(uLightDir,[0.6,1,0.4]);
  gl.uniform1f(uAmbient,0.35+nightFactor*-0.1);
  gl.uniform1f(uFogDist,35);
  gl.uniform3fv(uFogColor,sky);

  // Ground
  const groundModel=new Float32Array(mat4scale(60,0.2,60));
  const groundMVP=getMVP(view,proj,mat4mul(mat4translate(0,-0.15,0),mat4scale(60,0.2,60)));
  drawMesh(meshes.cube1,groundMVP,groundModel,[0.35,0.55,0.2]);

  // Farm soil patches
  for(let r=0;r<FARM_ROWS;r++){
    for(let c=0;c<FARM_COLS;c++){
      const cp=cellPos(c,r);
      const m=mat4mul(mat4translate(cp[0],0.01,cp[2]),mat4scale(CELL_SIZE-0.2,0.12,CELL_SIZE-0.2));
      const mvp=getMVP(view,proj,m);
      const cell=getFarmCell(c,r);
      const sc=state.weather==='drought'?[0.45,0.28,0.08]:[0.38,0.22,0.06];
      drawMesh(meshes.cube1,mvp,m,sc);
    }
  }

  // Fences around farm
  drawFences(view,proj);

  // Crops
  state.cropCells.forEach(c=>{
    const cp=cellPos(c.col,c.row);
    const ct=CROP_TYPES[c.type];
    const growH=0.2+c.growth*0.8;
    // stem
    const sm=mat4mul(mat4translate(cp[0],0.08,cp[2]),mat4scale(1,growH,1));
    drawMesh(meshes.stalk,getMVP(view,proj,sm),sm,[0.2,0.6,0.15]);
    // head
    if(c.stage>=1){
      const hm=mat4mul(mat4translate(cp[0],0.08+growH*0.7,cp[2]),mat4scale(0.7+c.growth*0.3,0.7+c.growth*0.3,0.7+c.growth*0.3));
      drawMesh(meshes.ball,getMVP(view,proj,hm),hm,ct.color);
    }
  });

  // Towers
  state.towers.forEach(t=>{
    const cp=cellPos(t.col,t.row);
    const tt=TOWER_TYPES[t.type];
    drawTower(t,cp,view,proj,tt.color);
  });

  // Enemies
  state.enemies.forEach(e=>{
    const m=mat4mul(mat4translate(...e.pos),mat4scale(e.size*2,e.size*1.2,e.size*2));
    drawMesh(meshes.enemy,getMVP(view,proj,m),m,e.color);
    // hp bar (billboard using small cubes)
    const barW=1.0*(e.hp/e.maxHp);
    const bm=mat4mul(mat4translate(e.pos[0]-0.5,e.pos[1]+0.6,e.pos[2]),mat4scale(barW,0.12,0.12));
    drawMesh(meshes.cube1,getMVP(view,proj,bm),bm,[0.2,0.8,0.2]);
  });

  // Projectiles
  state.projectiles.forEach(p=>{
    const m=mat4translate(...p.pos);
    drawMesh(meshes.projectile,getMVP(view,proj,new Float32Array(m)),new Float32Array(m),p.color||[1,0.8,0]);
  });

  // Particles
  state.particles.forEach(p=>{
    const s=0.1*(p.life/p.maxLife);
    const m=mat4mul(mat4translate(...p.pos),mat4scale(s,s,s));
    drawMesh(meshes.cube0_3,getMVP(view,proj,m),m,p.color);
  });
}

function drawTower(tower,cp,view,proj,color){
  const lv=tower.level;
  // trunk
  const tm=mat4mul(mat4translate(cp[0],0.1,cp[2]),mat4scale(lv*0.3,1,lv*0.3));
  drawMesh(meshes.trunk,getMVP(view,proj,tm),tm,color);

  if(tower.type==='cactus'){
    const cm=mat4mul(mat4translate(cp[0],0.6,cp[2]),mat4scale(1,0.8,1));
    drawMesh(meshes.cactus,getMVP(view,proj,cm),cm,[0.15,0.65,0.15]);
    // arms
    [-0.3,0.3].forEach(ox=>{
      const am=mat4mul(mat4translate(cp[0]+ox,0.7,cp[2]),mat4scale(0.5,0.4,0.5));
      drawMesh(meshes.cactus,getMVP(view,proj,am),am,[0.15,0.65,0.15]);
    });
  } else if(tower.type==='sunflower'){
    const hm=mat4mul(mat4translate(cp[0],1.3,cp[2]),mat4scale(0.8+lv*0.1,0.8+lv*0.1,0.8+lv*0.1));
    drawMesh(meshes.sunHead,getMVP(view,proj,hm),hm,[0.95,0.8,0.05]);
    const cm=mat4mul(mat4translate(cp[0],1.3,cp[2]),mat4scale(0.3,0.3,0.3));
    drawMesh(meshes.cube1,getMVP(view,proj,cm),cm,[0.5,0.25,0.05]);
  } else if(tower.type==='rosebush'){
    const bm=mat4mul(mat4translate(cp[0],0.5,cp[2]),mat4scale(1,0.8+lv*0.2,1));
    drawMesh(meshes.rose,getMVP(view,proj,bm),bm,[0.1,0.45,0.1]);
    const rm=mat4mul(mat4translate(cp[0],0.9+lv*0.1,cp[2]),mat4scale(0.5,0.5,0.5));
    drawMesh(meshes.ball,getMVP(view,proj,rm),rm,[0.85,0.1,0.25]);
  }
}

function drawFences(view,proj){
  const hs=FARM_COLS*CELL_SIZE/2+0.5;
  const step=1;
  for(let x=-hs;x<=hs;x+=step){
    [[-hs,-hs],[hs,hs]].forEach(([_,z])=>{
      const m=mat4mul(mat4translate(x,0,z),mat4scale(1,1,1));
      drawMesh(meshes.fence,getMVP(view,proj,m),m,[0.55,0.35,0.15]);
    });
  }
  for(let z=-hs;z<=hs;z+=step){
    [[-hs],[hs]].forEach(([x])=>{
      const m=mat4mul(mat4translate(x,0,z),mat4scale(1,1,1));
      drawMesh(meshes.fence,getMVP(view,proj,m),m,[0.55,0.35,0.15]);
    });
  }
}

// ============================================================
// MAIN LOOP
// ============================================================
let lastTime=0;
function gameLoop(ts){
  const dt=Math.min((ts-lastTime)/1000,0.05);
  lastTime=ts;

  if(!state.gameOver){
    updatePlayer(dt);
    updateCrops(dt);
    updateEnemies(dt);
    updateTowers(dt);
    updateProjectiles(dt);
    updateParticles(dt);
    updateWaves(dt);
    updateWeather(dt);
    updateDay(dt);
    checkGameOver();
    updateHUD();
  }

  render();
  drawRain();
  requestAnimationFrame(gameLoop);
}

// ============================================================
// UI HOOKS
// ============================================================
document.getElementById('start-btn').addEventListener('click',()=>{
  document.getElementById('intro-screen').style.display='none';
  canvas.requestPointerLock();
  initState();
  notify('🌱 Welcome to the farm! Plant some seeds to get started.','success');
  notify('Press B to open the shop!');
  updateHUD();
  requestAnimationFrame(ts=>{lastTime=ts;gameLoop(ts);});
});

document.getElementById('restart-btn').addEventListener('click',()=>{
  document.getElementById('game-over').style.display='none';
  document.getElementById('weather-overlay').className='';
  document.getElementById('rain-canvas').classList.remove('active');
  document.getElementById('notifications').innerHTML='';
  initState();
  updateHUD();
  canvas.requestPointerLock();
  notify('🌱 Starting fresh! Grow those crops!','success');
});

// Start a placeholder loop for the intro screen
requestAnimationFrame(function loop(ts){
  if(document.getElementById('intro-screen').style.display==='none') return;
  gl.clearColor(0.05,0.15,0.05,1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  requestAnimationFrame(loop);
});

