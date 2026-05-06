// ============================================================
// GARDEN DEFENSE - Full 3D First-Person Tower Defense
// Fixed for proper rendering
// ============================================================

const canvas = document.getElementById('game-canvas');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
  alert('Your browser does not support WebGL. The game cannot run.');
  throw new Error('WebGL not supported');
}

const rainCanvas = document.getElementById('rain-canvas');
const rainCtx = rainCanvas.getContext('2d');

// ---- Resize ----
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  rainCanvas.width = window.innerWidth;
  rainCanvas.height = window.innerHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// ============================================================
// MATH UTILS
// ============================================================
const DEG = Math.PI / 180;
function v3(x,y,z){ return [x,y,z]; }
function v3add(a,b){ return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function v3sub(a,b){ return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function v3scale(a,s){ return [a[0]*s, a[1]*s, a[2]*s]; }
function v3dot(a,b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function v3len(a){ return Math.sqrt(v3dot(a,a)); }
function v3norm(a){ const l = v3len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
function v3cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dist2d(a,b){ return Math.sqrt((a[0]-b[0])**2 + (a[2]-b[2])**2); }

function mat4identity(){ return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
function mat4mul(a,b){
  const a32 = new Float32Array(a);
  const b32 = new Float32Array(b);
  const r = new Float32Array(16);
  for(let i=0;i<4;i++) {
    for(let j=0;j<4;j++) {
      let s=0;
      for(let k=0;k<4;k++) s += a32[i*4+k] * b32[k*4+j];
      r[i*4+j] = s;
    }
  }
  return r;
}
function mat4perspective(fov, asp, near, far){
  const f = 1/Math.tan(fov/2);
  const nf = 1/(near-far);
  return new Float32Array([
    f/asp, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far+near)*nf, -1,
    0, 0, 2*far*near*nf, 0
  ]);
}
function mat4lookAt(eye, center, up){
  const z = v3norm(v3sub(eye, center));
  const x = v3norm(v3cross(up, z));
  const y = v3cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -v3dot(x,eye), -v3dot(y,eye), -v3dot(z,eye), 1
  ]);
}
function mat4translate(x,y,z){
  const m = mat4identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}
function mat4scale(x,y,z){
  const m = mat4identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}
function mat4rotY(a){
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
}

// ============================================================
// SHADERS - Fixed with working lighting
// ============================================================
const vsSource = `
attribute vec3 aPos;
attribute vec3 aNorm;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNorm;
varying vec3 vPos;
void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vPos = world.xyz;
  vNorm = (uModel * vec4(aNorm, 0.0)).xyz;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const fsSource = `
precision mediump float;
varying vec3 vNorm;
varying vec3 vPos;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uFogDist;
uniform vec3 uFogColor;
void main(){
  vec3 n = normalize(vNorm);
  vec3 lightDir = normalize(uLightDir);
  float diff = max(dot(n, lightDir), 0.15);
  vec3 lit = uColor * (uAmbient + diff * (1.0 - uAmbient));
  float fogF = clamp(length(vPos) / uFogDist, 0.0, 1.0);
  gl_FragColor = vec4(mix(lit, uFogColor, fogF * 0.4), 1.0);
}`;

function compileShader(type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

const vertShader = compileShader(gl.VERTEX_SHADER, vsSource);
const fragShader = compileShader(gl.FRAGMENT_SHADER, fsSource);

if (!vertShader || !fragShader) {
  throw new Error('Failed to compile shaders');
}

const prog = gl.createProgram();
gl.attachShader(prog, vertShader);
gl.attachShader(prog, fragShader);
gl.linkProgram(prog);

if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  console.error('Program link error:', gl.getProgramInfoLog(prog));
  throw new Error('Failed to link program');
}

gl.useProgram(prog);

const aPos   = gl.getAttribLocation(prog, 'aPos');
const aNorm  = gl.getAttribLocation(prog, 'aNorm');
const uMVP   = gl.getUniformLocation(prog, 'uMVP');
const uModel = gl.getUniformLocation(prog, 'uModel');
const uColor = gl.getUniformLocation(prog, 'uColor');
const uLightDir = gl.getUniformLocation(prog, 'uLightDir');
const uAmbient = gl.getUniformLocation(prog, 'uAmbient');
const uFogDist = gl.getUniformLocation(prog, 'uFogDist');
const uFogColor = gl.getUniformLocation(prog, 'uFogColor');

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);

// ============================================================
// MESH FACTORY - Fixed vertex attribute setup
// ============================================================
function makeCubeMesh(w, h, d) {
  const hw = w/2, hh = h/2, hd = d/2;
  const positions = [
    // Front face
    -hw, -hh,  hd,  hw, -hh,  hd,  hw,  hh,  hd, -hw,  hh,  hd,
    // Back face
    -hw, -hh, -hd, -hw,  hh, -hd,  hw,  hh, -hd,  hw, -hh, -hd,
    // Top face
    -hw,  hh, -hd, -hw,  hh,  hd,  hw,  hh,  hd,  hw,  hh, -hd,
    // Bottom face
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh,  hd, -hw, -hh,  hd,
    // Right face
    hw, -hh, -hd,  hw,  hh, -hd,  hw,  hh,  hd,  hw, -hh,  hd,
    // Left face
    -hw, -hh, -hd, -hw, -hh,  hd, -hw,  hh,  hd, -hw,  hh, -hd
  ];
  
  const normals = [
    // Front
    0,0,1, 0,0,1, 0,0,1, 0,0,1,
    // Back
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    // Top
    0,1,0, 0,1,0, 0,1,0, 0,1,0,
    // Bottom
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    // Right
    1,0,0, 1,0,0, 1,0,0, 1,0,0,
    // Left
    -1,0,0, -1,0,0, -1,0,0, -1,0,0
  ];
  
  const indices = [];
  for(let i = 0; i < 6; i++) {
    const base = i * 4;
    indices.push(base, base+1, base+2, base, base+2, base+3);
  }
  
  return createMesh(new Float32Array(positions), new Float32Array(normals), new Uint16Array(indices));
}

function makeCylinderMesh(r, h, segs) {
  const positions = [], normals = [], indices = [];
  const topY = h/2, botY = -h/2;
  
  for(let i = 0; i <= segs; i++) {
    const a = i / segs * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // bottom vertex
    positions.push(x, botY, z);
    normals.push(x/r, 0, z/r);
    // top vertex
    positions.push(x, topY, z);
    normals.push(x/r, 0, z/r);
  }
  
  for(let i = 0; i < segs; i++) {
    const b = i * 2;
    indices.push(b, b+1, b+2);
    indices.push(b+1, b+3, b+2);
  }
  
  return createMesh(new Float32Array(positions), new Float32Array(normals), new Uint16Array(indices));
}

function makeConeMesh(r, h, segs) {
  const positions = [0, h/2, 0];
  const normals = [0, 1, 0];
  const indices = [];
  
  for(let i = 0; i <= segs; i++) {
    const a = i / segs * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    positions.push(x, -h/2, z);
    const len = Math.sqrt(x*x + 1 + z*z);
    normals.push(x/len, 0.5/len, z/len);
  }
  
  for(let i = 0; i < segs; i++) {
    indices.push(0, i+1, i+2);
  }
  
  return createMesh(new Float32Array(positions), new Float32Array(normals), new Uint16Array(indices));
}

function createMesh(positions, normals, indices) {
  const pb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pb);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  
  const nb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nb);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
  
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  
  return { pb, nb, ib, count: indices.length };
}

// Create meshes
const meshes = {
  cube1: makeCubeMesh(1, 1, 1),
  cube0_3: makeCubeMesh(0.3, 0.3, 0.3),
  soil: makeCubeMesh(1.2, 0.1, 1.2),
  stalk: makeCylinderMesh(0.05, 0.6, 8),
  trunk: makeCylinderMesh(0.08, 1.2, 8),
  ball: makeConeMesh(0.4, 0.8, 12),
  enemy: makeCubeMesh(0.4, 0.3, 0.6),
  slug: makeCylinderMesh(0.18, 0.15, 10),
  projectile: makeConeMesh(0.08, 0.2, 6),
  fence: makeCubeMesh(0.08, 0.8, 8),
  cactus: makeCylinderMesh(0.12, 0.9, 8),
  sunHead: makeConeMesh(0.5, 0.5, 16),
  rose: makeCubeMesh(0.5, 1.0, 0.5),
};

// ============================================================
// DRAW MESH
// ============================================================
function drawMesh(mesh, mvp, model, color) {
  if (!mesh || !mesh.pb) return;
  
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPos);
  
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nb);
  gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aNorm);
  
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
  gl.uniformMatrix4fv(uMVP, false, mvp);
  gl.uniformMatrix4fv(uModel, false, model || mat4identity());
  gl.uniform3fv(uColor, color);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
}

function getMVP(view, proj, model) {
  return mat4mul(mat4mul(proj, view), model);
}

// ============================================================
// GAME STATE (same as before - kept for brevity)
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
    dayLength: 90,
    gameOver: false,
    cropCells: [],
    towers: [],
    enemies: [],
    projectiles: [],
    particles: [],
    weather: 'clear',
    weatherTimer: 0,
    waveEnemies: 0,
    waveSpawnTimer: 0,
    waveCooldown: 10,
    waveActive: false,
    seeds: {carrot:3, wheat:2, pumpkin:0},
    harvestable: 0,
    selectedTool: null,
    farmGrid: [],
  };
  buildFarmGrid();
}

function buildFarmGrid(){
  state.farmGrid = [];
  for(let r=0; r<FARM_ROWS; r++)
    for(let c=0; c<FARM_COLS; c++)
      state.farmGrid.push({col:c, row:r, hasCrop:false, hasTower:false});
}

function cellPos(col, row){
  return [
    FARM_ORIGIN[0] + col*CELL_SIZE + CELL_SIZE/2,
    0,
    FARM_ORIGIN[2] + row*CELL_SIZE + CELL_SIZE/2
  ];
}

// Player
const player = {
  pos: [0, 1.7, 8],
  yaw: 0,
  pitch: 0,
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
    if(e.code==='Escape'){ state.selectedTool=null; updateToolbar(); }
  }
});
document.addEventListener('keyup', e=>{ keys[e.code]=false; });

// Pointer lock
canvas.addEventListener('click', ()=>{
  if(!document.pointerLockElement) canvas.requestPointerLock();
});
document.addEventListener('mousemove', e=>{
  if(document.pointerLockElement === canvas){
    player.yaw    += e.movementX * 0.003;
    player.pitch   = Math.max(-1.2, Math.min(1.2, player.pitch - e.movementY * 0.003));
  }
});
document.addEventListener('mousedown', e=>{
  if(e.button===0 && document.pointerLockElement===canvas) useTool();
});

// Simplified tools for brevity - kept from original
function selectTool(t){
  state.selectedTool = t;
  updateToolbar();
}

function updateToolbar(){
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>{
    b.classList.toggle('active', b.dataset.tool === state.selectedTool);
  });
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>{
  b.addEventListener('click', ()=>selectTool(b.dataset.tool));
});
document.getElementById('shop-toggle-btn').addEventListener('click', toggleShop);

function toggleShop(){
  const p = document.getElementById('shop-panel');
  p.style.display = p.style.display === 'block' ? 'none' : 'block';
}

// Quick helper functions
function getFarmCell(col,row){ return state.farmGrid.find(c=>c.col===col && c.row===row); }

function getFacingDir(){
  return [
    Math.sin(player.yaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(player.yaw) * Math.cos(player.pitch)
  ];
}

function updatePlayer(dt){
  const spd = state.weather==='tornado' ? 2.5 : player.speed;
  const cos = Math.cos(player.yaw), sin = Math.sin(player.yaw);
  let dx=0, dz=0;
  if(keys['KeyW']){ dx += sin; dz -= cos; }
  if(keys['KeyS']){ dx -= sin; dz += cos; }
  if(keys['KeyA']){ dx -= cos; dz -= sin; }
  if(keys['KeyD']){ dx += cos; dz += sin; }
  const len = Math.sqrt(dx*dx+dz*dz);
  if(len>0){ dx/=len; dz/=len; }
  player.pos[0] += dx * spd * dt;
  player.pos[2] += dz * spd * dt;
  const bound = FARM_COLS*CELL_SIZE/2 + 6;
  player.pos[0] = Math.max(-bound, Math.min(bound, player.pos[0]));
  player.pos[2] = Math.max(-bound, Math.min(bound, player.pos[2]));
}

function useTool(){
  // Simplified - keeps game functional
  const tool = state.selectedTool;
  if(!tool) return;
  
  if(tool === 'salt'){
    if(state.saltCount <= 0){ notify('No salt!', 'danger'); return; }
    let killed = false;
    state.enemies = state.enemies.filter(e=>{
      if((e.type==='slug'||e.type==='snail') && dist2d(e.pos, player.pos) < 3){
        killed = true;
        return false;
      }
      return true;
    });
    if(killed){ state.saltCount--; notify('Salt killed pest!', 'success'); }
    else notify('No slugs nearby', 'danger');
    updateHUD();
    return;
  }
  
  // Raycast for planting
  const dir = getFacingDir();
  let hit = null;
  for(let t=0.5; t<10; t+=0.25){
    const p = [player.pos[0]+dir[0]*t, player.pos[1]+dir[1]*t-1.7, player.pos[2]+dir[2]*t];
    for(let r=0; r<FARM_ROWS; r++){
      for(let c=0; c<FARM_COLS; c++){
        const cp = cellPos(c,r);
        const hs = CELL_SIZE/2;
        if(Math.abs(p[0]-cp[0])<hs && Math.abs(p[2]-cp[2])<hs && p[1]>-0.2 && p[1]<0.3){
          hit = {col:c, row:r};
          break;
        }
      }
      if(hit) break;
    }
    if(hit) break;
  }
  
  if(!hit){ notify('Aim at soil!', 'danger'); return; }
  
  if(tool.startsWith('seed-')){
    const type = tool.replace('seed-','');
    if(state.seeds[type] <= 0){ notify(`No ${type} seeds`, 'danger'); return; }
    const cell = getFarmCell(hit.col, hit.row);
    if(cell.hasCrop || cell.hasTower){ notify('Spot taken', 'danger'); return; }
    state.seeds[type]--;
    cell.hasCrop = true;
    state.cropCells.push({col:hit.col, row:hit.row, type:type, growth:0, stage:0, hp:3});
    notify(`Planted ${type}!`, 'success');
    updateHUD();
  }
  else if(tool.startsWith('tower-')){
    const type = tool.replace('tower-','');
    const tt = TOWER_TYPES[type];
    if(state.money < tt.cost){ notify('Not enough money', 'danger'); return; }
    const cell = getFarmCell(hit.col, hit.row);
    if(cell.hasCrop || cell.hasTower){ notify('Spot taken', 'danger'); return; }
    state.money -= tt.cost;
    cell.hasTower = true;
    state.towers.push({col:hit.col, row:hit.row, type:type, level:1, cooldown:0, hp:10, maxHp:10, type_data:Object.assign({}, tt)});
    state.selectedTool = null;
    updateToolbar();
    notify(`${tt.icon} tower placed!`, 'success');
    updateHUD();
  }
}

function tryInteract(){
  let best = null, bd = 4;
  state.cropCells.forEach(c=>{
    if(c.stage >= 2){
      const d = dist2d(player.pos, cellPos(c.col, c.row));
      if(d < bd){ bd = d; best = c; }
    }
  });
  if(best){
    const ct = CROP_TYPES[best.type];
    const val = ct.sellValue;
    state.money += val;
    notify(`Harvested ${ct.icon} for $${val}!`, 'success');
    const cell = getFarmCell(best.col, best.row);
    cell.hasCrop = false;
    state.cropCells = state.cropCells.filter(c => c !== best);
    updateHUD();
  } else {
    notify('No ripe crops nearby', 'danger');
  }
}

// Enemy functions
const ENEMY_TYPES = {
  slug:   {hp:20, speed:0.5, dmg:0.5, color:[0.5,0.7,0.3], icon:'🐌', size:0.3},
  snail:  {hp:30, speed:0.4, dmg:0.5, color:[0.6,0.6,0.4], icon:'🐌', size:0.35},
  rabbit: {hp:15, speed:1.8, dmg:1.0, color:[0.8,0.7,0.65], icon:'🐇', size:0.4},
  crow:   {hp:12, speed:2.5, dmg:0.8, color:[0.2,0.2,0.2], icon:'🐦', size:0.35},
  thief:  {hp:40, speed:1.2, dmg:2.0, color:[0.3,0.15,0.05], icon:'🕵️', size:0.5},
};

function spawnEnemy(type){
  const et = ENEMY_TYPES[type];
  const hs = FARM_COLS*CELL_SIZE/2 + 4;
  const edge = Math.floor(Math.random()*4);
  let pos;
  if(edge===0) pos = [-hs + Math.random()*hs*2, 0.2, -hs];
  else if(edge===1) pos = [-hs + Math.random()*hs*2, 0.2, hs];
  else if(edge===2) pos = [-hs, 0.2, -hs + Math.random()*hs*2];
  else pos = [hs, 0.2, -hs + Math.random()*hs*2];
  state.enemies.push({
    type:type, pos:pos, hp:et.hp*(1+state.wave*0.15), maxHp:et.hp*(1+state.wave*0.15),
    speed:et.speed*(1+state.wave*0.05), dmg:et.dmg, target:null, color:et.color, stunned:0, size:et.size
  });
}

function updateEnemies(dt){
  state.enemies.forEach(e=>{
    if(e.stunned>0){ e.stunned-=dt; return; }
    let best = null, bd = 999;
    state.cropCells.forEach(c=>{
      const d = dist2d(e.pos, cellPos(c.col, c.row));
      if(d < bd){ bd = d; best = c; }
    });
    if(best){
      const tp = cellPos(best.col, best.row);
      const dir = v3norm(v3sub(tp, e.pos));
      e.pos[0] += dir[0] * e.speed * dt;
      e.pos[2] += dir[2] * e.speed * dt;
      if(bd < 0.8){
        best.hp -= e.dmg * dt;
        if(best.hp <= 0){
          notify(`Crop destroyed!`, 'danger');
          getFarmCell(best.col, best.row).hasCrop = false;
          state.cropCells = state.cropCells.filter(c => c !== best);
        }
      }
    }
  });
}

function updateTowers(dt){
  state.towers.forEach(tower=>{
    tower.cooldown -= dt;
    if(tower.cooldown > 0) return;
    const tt = tower.type_data;
    const tp = cellPos(tower.col, tower.row);
    let best = null, bd = tt.range;
    state.enemies.forEach(e=>{
      if(!tt.targets.includes(e.type)) return;
      const d = dist2d(tp, e.pos);
      if(d < bd){ bd = d; best = e; }
    });
    if(best){
      tower.cooldown = 1/tt.rate;
      const dir = v3norm(v3sub(best.pos, [tp[0], tp[1]+0.8, tp[2]]));
      state.projectiles.push({
        pos:[tp[0], tp[1]+0.8, tp[2]],
        vel:[dir[0]*8, dir[1]*8, dir[2]*8],
        dmg:tt.dmg, life:2, target:best,
        color:tt.color
      });
    }
  });
}

function updateProjectiles(dt){
  state.projectiles = state.projectiles.filter(p=>{
    p.pos[0] += p.vel[0]*dt;
    p.pos[1] += p.vel[1]*dt;
    p.pos[2] += p.vel[2]*dt;
    p.life -= dt;
    if(p.life < 0) return false;
    for(let i=0; i<state.enemies.length; i++){
      const e = state.enemies[i];
      if(dist2d(p.pos, e.pos) < 0.6 && Math.abs(p.pos[1]-e.pos[1]) < 0.8){
        e.hp -= p.dmg;
        if(e.hp <= 0){
          state.enemies.splice(i,1);
          state.money += 3;
          updateHUD();
        }
        return false;
      }
    }
    return true;
  });
}

function updateCrops(dt){
  const droughtFactor = state.weather === 'drought' ? 0.3 : 1;
  state.cropCells.forEach(c=>{
    const ct = CROP_TYPES[c.type];
    c.growth += (dt/ct.growTime) * droughtFactor;
    c.stage = c.growth < 0.5 ? 0 : c.growth < 1 ? 1 : 2;
  });
}

function spawnParticles(pos, color){
  for(let i=0;i<6;i++){
    state.particles.push({
      pos:[...pos],
      vel:[(Math.random()-0.5)*3, (Math.random()*2+1), (Math.random()-0.5)*3],
      life:1+Math.random()*0.5,
      maxLife:1.5,
      color:color
    });
  }
}

function updateParticles(dt){
  state.particles = state.particles.filter(p=>{
    p.pos[0] += p.vel[0]*dt;
    p.pos[1] += p.vel[1]*dt;
    p.pos[2] += p.vel[2]*dt;
    p.vel[1] -= 5*dt;
    p.life -= dt;
    return p.life > 0;
  });
}

function updateWaves(dt){
  if(!state.waveActive){
    state.waveCooldown -= dt;
    if(state.waveCooldown <= 0){
      state.waveActive = true;
      const count = 3 + state.wave * 2;
      state.waveEnemies = count;
      state.waveSpawnTimer = 0;
      notify(`Wave ${state.wave} starting!`, 'danger');
    }
    return;
  }
  state.waveSpawnTimer -= dt;
  if(state.waveSpawnTimer <= 0 && state.waveEnemies > 0){
    state.waveSpawnTimer = 1.5 - Math.min(1, state.wave*0.05);
    const types = ['slug','snail','rabbit'];
    spawnEnemy(types[Math.floor(Math.random()*types.length)]);
    state.waveEnemies--;
  }
  if(state.waveEnemies <= 0 && state.enemies.length === 0){
    state.waveActive = false;
    state.wave++;
    state.waveCooldown = 12;
    notify(`Wave ${state.wave-1} cleared!`, 'success');
    state.money += 10 + state.wave * 3;
    updateHUD();
  }
}

function triggerWeather(type){
  state.weather = type;
  state.weatherTimer = type === 'drought' ? 25 : 12;
  const overlay = document.getElementById('weather-overlay');
  overlay.className = type;
  if(type === 'drought'){
    notify('DROUGHT!', 'weather');
  } else {
    notify('TORNADO!', 'weather');
    const shuffled = [...state.cropCells].sort(()=>Math.random()-0.5);
    shuffled.slice(0, Math.ceil(shuffled.length*0.4)).forEach(c=>{
      c.hp -= 2;
      if(c.hp <= 0){
        notify(`Tornado destroyed a crop!`, 'danger');
        getFarmCell(c.col, c.row).hasCrop = false;
      }
    });
    state.cropCells = state.cropCells.filter(c=>c.hp > 0);
  }
}

function updateWeather(dt){
  if(state.weather !== 'clear'){
    state.weatherTimer -= dt;
    if(state.weatherTimer <= 0){
      state.weather = 'clear';
      document.getElementById('weather-overlay').className = '';
      notify('Weather passed', 'success');
    }
    return;
  }
  if(Math.random() < 0.0005 * dt * 60){
    triggerWeather(Math.random()<0.5 ? 'drought' : 'tornado');
  }
}

function updateDay(dt){
  state.dayTimer += dt;
  if(state.dayTimer >= state.dayLength){
    state.dayTimer = 0;
    state.day++;
    updateHUD();
  }
}

function checkGameOver(){
  const hasCrops = state.cropCells.length > 0 || Object.values(state.seeds).some(v=>v>0);
  const hasMoney = state.money > 0;
  if(!hasCrops && !hasMoney && state.enemies.length > 0){
    state.gameOver = true;
    document.getElementById('game-over').style.display = 'flex';
    document.getElementById('go-score').textContent = `Day ${state.day} — Wave ${state.wave}`;
    if(document.pointerLockElement) document.exitPointerLock();
  }
}

function updateHUD(){
  document.getElementById('hud-money').textContent = '$' + state.money;
  document.getElementById('hud-crops').textContent = state.cropCells.length;
  document.getElementById('hud-salt').textContent = state.saltCount;
  document.getElementById('hud-day').textContent = state.day;
  document.getElementById('hud-wave').textContent = state.wave;
}

function notify(msg, type=''){
  const cont = document.getElementById('notifications');
  const el = document.createElement('div');
  el.className = 'notif ' + (type||'');
  el.textContent = msg;
  cont.appendChild(el);
  setTimeout(()=>el.remove(), 3000);
}

function buyItem(item){
  const costs = {
    'salt':10, 'seed-carrot-bulk':12, 'seed-wheat-bulk':20, 'seed-pumpkin-bulk':25,
    'tower-cactus':30, 'tower-sunflower':50, 'tower-rosebush':70, 'upgrade-tower':60
  };
  const cost = costs[item];
  if(state.money < cost){ notify('Not enough money!', 'danger'); return; }
  state.money -= cost;
  if(item === 'salt') state.saltCount += 5;
  else if(item === 'seed-carrot-bulk') state.seeds.carrot += 3;
  else if(item === 'seed-wheat-bulk') state.seeds.wheat += 3;
  else if(item === 'seed-pumpkin-bulk') state.seeds.pumpkin += 2;
  else if(item === 'tower-cactus') selectTool('tower-cactus');
  else if(item === 'tower-sunflower') selectTool('tower-sunflower');
  else if(item === 'tower-rosebush') selectTool('tower-rosebush');
  notify(`Bought: ${item}`, 'success');
  updateHUD();
}

document.querySelectorAll('.shop-item').forEach(el=>{
  el.addEventListener('click', ()=>buyItem(el.dataset.buy));
});

// ============================================================
// RENDERING
// ============================================================
function getViewMatrix(){
  const eye = [...player.pos];
  const dir = getFacingDir();
  const center = [eye[0]+dir[0], eye[1]+dir[1], eye[2]+dir[2]];
  return mat4lookAt(eye, center, [0,1,0]);
}

function getProjMatrix(){
  return mat4perspective(70*DEG, canvas.width/canvas.height, 0.1, 80);
}

function render(){
  const view = getViewMatrix();
  const proj = getProjMatrix();
  
  // Sky color
  let sky = [0.53, 0.81, 0.92];
  if(state.weather === 'drought') sky = [0.7, 0.55, 0.2];
  else if(state.weather === 'tornado') sky = [0.3, 0.3, 0.4];
  
  gl.clearColor(...sky, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  
  gl.uniform3fv(uLightDir, [0.6, 1, 0.4]);
  gl.uniform1f(uAmbient, 0.45);
  gl.uniform1f(uFogDist, 45);
  gl.uniform3fv(uFogColor, sky);
  
  // Ground plane
  const groundModel = mat4scale(60, 0.2, 60);
  const groundMVP = getMVP(view, proj, mat4mul(mat4translate(0, -0.15, 0), mat4scale(60, 0.2, 60)));
  drawMesh(meshes.cube1, groundMVP, groundModel, [0.35, 0.55, 0.2]);
  
  // Farm soil
  for(let r=0; r<FARM_ROWS; r++){
    for(let c=0; c<FARM_COLS; c++){
      const cp = cellPos(c, r);
      const model = mat4mul(mat4translate(cp[0], 0.01, cp[2]), mat4scale(CELL_SIZE-0.2, 0.12, CELL_SIZE-0.2));
      const mvp = getMVP(view, proj, model);
      drawMesh(meshes.cube1, mvp, model, [0.38, 0.22, 0.06]);
    }
  }
  
  // Crops
  state.cropCells.forEach(c=>{
    const cp = cellPos(c.col, c.row);
    const ct = CROP_TYPES[c.type];
    const growH = 0.2 + c.growth * 0.8;
    // Stem
    const stemModel = mat4mul(mat4translate(cp[0], 0.08, cp[2]), mat4scale(1, growH, 1));
    drawMesh(meshes.stalk, getMVP(view, proj, stemModel), stemModel, [0.2, 0.6, 0.15]);
    // Head
    if(c.stage >= 1){
      const headModel = mat4mul(mat4translate(cp[0], 0.08 + growH*0.7, cp[2]), mat4scale(0.7 + c.growth*0.3, 0.7 + c.growth*0.3, 0.7 + c.growth*0.3));
      drawMesh(meshes.ball, getMVP(view, proj, headModel), headModel, ct.color);
    }
  });
  
  // Towers
  state.towers.forEach(t=>{
    const cp = cellPos(t.col, t.row);
    const tt = TOWER_TYPES[t.type];
    const trunkModel = mat4mul(mat4translate(cp[0], 0.1, cp[2]), mat4scale(t.level*0.3, 1, t.level*0.3));
    drawMesh(meshes.trunk, getMVP(view, proj, trunkModel), trunkModel, tt.color);
    
    if(t.type === 'cactus'){
      const cactusModel = mat4mul(mat4translate(cp[0], 0.6, cp[2]), mat4scale(1, 0.8, 1));
      drawMesh(meshes.cactus, getMVP(view, proj, cactusModel), cactusModel, [0.15, 0.65, 0.15]);
    } else if(t.type === 'sunflower'){
      const headModel = mat4mul(mat4translate(cp[0], 1.3, cp[2]), mat4scale(0.8 + t.level*0.1, 0.8 + t.level*0.1, 0.8 + t.level*0.1));
      drawMesh(meshes.sunHead, getMVP(view, proj, headModel), headModel, [0.95, 0.8, 0.05]);
    } else if(t.type === 'rosebush'){
      const bushModel = mat4mul(mat4translate(cp[0], 0.5, cp[2]), mat4scale(1, 0.8 + t.level*0.2, 1));
      drawMesh(meshes.rose, getMVP(view, proj, bushModel), bushModel, [0.1, 0.45, 0.1]);
      const roseModel = mat4mul(mat4translate(cp[0], 0.9 + t.level*0.1, cp[2]), mat4scale(0.5, 0.5, 0.5));
      drawMesh(meshes.ball, getMVP(view, proj, roseModel), roseModel, [0.85, 0.1, 0.25]);
    }
  });
  
  // Enemies
  state.enemies.forEach(e=>{
    const model = mat4mul(mat4translate(e.pos[0], e.pos[1], e.pos[2]), mat4scale(e.size*2, e.size*1.2, e.size*2));
    drawMesh(meshes.enemy, getMVP(view, proj, model), model, e.color);
    // Health bar
    const barW = 1.0 * (e.hp / e.maxHp);
    const barModel = mat4mul(mat4translate(e.pos[0]-0.5, e.pos[1]+0.6, e.pos[2]), mat4scale(barW, 0.12, 0.12));
    drawMesh(meshes.cube1, getMVP(view, proj, barModel), barModel, [0.2, 0.8, 0.2]);
  });
  
  // Projectiles
  state.projectiles.forEach(p=>{
    const model = mat4translate(p.pos[0], p.pos[1], p.pos[2]);
    drawMesh(meshes.projectile, getMVP(view, proj, model), model, p.color || [1, 0.8, 0]);
  });
  
  // Particles
  state.particles.forEach(p=>{
    const s = 0.1 * (p.life / p.maxLife);
    const model = mat4mul(mat4translate(p.pos[0], p.pos[1], p.pos[2]), mat4scale(s, s, s));
    drawMesh(meshes.cube0_3, getMVP(view, proj, model), model, p.color);
  });
}

// ============================================================
// MAIN LOOP
// ============================================================
let lastTime = 0;
let animationId = null;

function gameLoop(ts){
  if(state.gameOver){
    render(); // Keep rendering game over screen
    if(animationId) requestAnimationFrame(gameLoop);
    return;
  }
  
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  
  if(dt > 0 && dt < 0.1){
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
  animationId = requestAnimationFrame(gameLoop);
}

// ============================================================
// UI HOOKS
// ============================================================
document.getElementById('start-btn').addEventListener('click', ()=>{
  document.getElementById('intro-screen').style.display = 'none';
  canvas.requestPointerLock();
  initState();
  notify('🌱 Welcome to the farm!', 'success');
  updateHUD();
  lastTime = performance.now();
  gameLoop(lastTime);
});

document.getElementById('restart-btn').addEventListener('click', ()=>{
  document.getElementById('game-over').style.display = 'none';
  document.getElementById('weather-overlay').className = '';
  initState();
  updateHUD();
  canvas.requestPointerLock();
  notify('🌱 Starting fresh!', 'success');
  lastTime = performance.now();
  if(animationId) cancelAnimationFrame(animationId);
  gameLoop(lastTime);
});

// Initial draw for intro screen
function drawIntro() {
  gl.clearColor(0.1, 0.2, 0.1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  requestAnimationFrame(drawIntro);
}
drawIntro();
