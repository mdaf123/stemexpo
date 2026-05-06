// ============================================================
// GARDEN DEFENSE - First Person Shooter Style Movement
// Like Muck - WASD movement, Mouse look, Smooth camera
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

// ============================================================
// SIMPLE SHADERS
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
void main(){
  vec3 n = normalize(vNorm);
  vec3 lightDir = normalize(uLightDir);
  float diff = max(dot(n, lightDir), 0.2);
  vec3 lit = uColor * (uAmbient + diff * (1.0 - uAmbient));
  gl_FragColor = vec4(lit, 1.0);
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

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);

// ============================================================
// MESH FACTORY
// ============================================================
function makeCubeMesh(w, h, d) {
  const hw = w/2, hh = h/2, hd = d/2;
  const positions = [
    // Front
    -hw, -hh,  hd,  hw, -hh,  hd,  hw,  hh,  hd, -hw,  hh,  hd,
    // Back
    -hw, -hh, -hd, -hw,  hh, -hd,  hw,  hh, -hd,  hw, -hh, -hd,
    // Top
    -hw,  hh, -hd, -hw,  hh,  hd,  hw,  hh,  hd,  hw,  hh, -hd,
    // Bottom
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh,  hd, -hw, -hh,  hd,
    // Right
    hw, -hh, -hd,  hw,  hh, -hd,  hw,  hh,  hd,  hw, -hh,  hd,
    // Left
    -hw, -hh, -hd, -hw, -hh,  hd, -hw,  hh,  hd, -hw,  hh, -hd
  ];
  
  const normals = [
    0,0,1, 0,0,1, 0,0,1, 0,0,1,
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    0,1,0, 0,1,0, 0,1,0, 0,1,0,
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    1,0,0, 1,0,0, 1,0,0, 1,0,0,
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
    positions.push(x, botY, z);
    normals.push(x/r, 0, z/r);
    positions.push(x, topY, z);
    normals.push(x/r, 0, z/r);
  }
  
  for(let i = 0; i < segs; i++) {
    const base = i * 2;
    indices.push(base, base+1, base+2, base+1, base+3, base+2);
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

// Create all meshes
const meshes = {
  cube1: makeCubeMesh(1, 1, 1),
  cube0_3: makeCubeMesh(0.3, 0.3, 0.3),
  stalk: makeCylinderMesh(0.08, 0.8, 8),
  trunk: makeCylinderMesh(0.1, 1.2, 8),
  ball: makeCylinderMesh(0.3, 0.5, 12),
  enemy: makeCubeMesh(0.5, 0.4, 0.7),
  projectile: makeCylinderMesh(0.08, 0.2, 6),
  fence: makeCubeMesh(0.1, 1.0, 0.1),
  cactus: makeCylinderMesh(0.15, 1.0, 8),
  sunflower: makeCylinderMesh(0.2, 1.2, 8),
  rose: makeCubeMesh(0.4, 0.8, 0.4),
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
// GAME STATE
// ============================================================
const FARM_COLS = 5, FARM_ROWS = 5;
const CELL_SIZE = 3.0;
const FARM_ORIGIN = [-(FARM_COLS*CELL_SIZE)/2, 0, -(FARM_ROWS*CELL_SIZE)/2];

const CROP_TYPES = {
  carrot:  {icon:'🥕', growTime:15, sellValue:12, seedCost:5,  color:[0.9,0.45,0.1]},
  wheat:   {icon:'🌾', growTime:25, sellValue:20, seedCost:8,  color:[0.9,0.8,0.2]},
  pumpkin: {icon:'🎃', growTime:40, sellValue:40, seedCost:15, color:[0.9,0.5,0.1]},
};

const TOWER_TYPES = {
  cactus:    {icon:'🌵', cost:30, dmg:10, range:5, rate:1.2, color:[0.2,0.7,0.2]},
  sunflower: {icon:'🌻', cost:50, dmg:8,  range:7, rate:1.0, color:[0.95,0.8,0.1]},
  rosebush:  {icon:'🌹', cost:70, dmg:15, range:4, rate:1.5, color:[0.85,0.15,0.25]},
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
    waveCooldown: 8,
    waveActive: false,
    seeds: {carrot:5, wheat:3, pumpkin:2},
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

// ============================================================
// FIRST PERSON PLAYER CONTROLS (Like Muck)
// ============================================================
const player = {
  pos: [0, 1.6, 6],
  vel: [0, 0, 0],
  yaw: -Math.PI / 2,
  pitch: 0,
  sprinting: false,
  speed: 5.0,
  sprintSpeed: 8.0,
};

const keys = {
  KeyW: false, KeyS: false, KeyA: false, KeyD: false,
  ShiftLeft: false, Space: false
};

document.addEventListener('keydown', (e) => {
  if (keys.hasOwnProperty(e.code)) {
    keys[e.code] = true;
    e.preventDefault();
  }
  
  if (!state.gameOver) {
    if (e.code === 'KeyB') toggleShop();
    if (e.code === 'Digit1') selectTool('salt');
    if (e.code === 'Digit2') selectTool('seed-carrot');
    if (e.code === 'Digit3') selectTool('seed-wheat');
    if (e.code === 'Digit4') selectTool('seed-pumpkin');
    if (e.code === 'Digit5') selectTool('tower-cactus');
    if (e.code === 'Digit6') selectTool('tower-sunflower');
    if (e.code === 'KeyE') tryInteract();
    if (e.code === 'Escape') { state.selectedTool = null; updateToolbar(); }
  }
});

document.addEventListener('keyup', (e) => {
  if (keys.hasOwnProperty(e.code)) {
    keys[e.code] = false;
  }
});

// Mouse look
canvas.addEventListener('click', () => {
  canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', lockChange);
document.addEventListener('mozpointerlockchange', lockChange);

function lockChange() {
  if (document.pointerLockElement === canvas) {
    document.addEventListener('mousemove', onMouseMove);
  } else {
    document.removeEventListener('mousemove', onMouseMove);
  }
}

function onMouseMove(e) {
  player.yaw -= e.movementX * 0.002;
  player.pitch -= e.movementY * 0.002;
  player.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, player.pitch));
}

// Click to use tool
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && document.pointerLockElement === canvas) {
    useTool();
  }
});

// Update player movement (like Muck)
function updatePlayer(dt) {
  // Sprinting
  player.sprinting = keys.ShiftLeft && (keys.KeyW || keys.KeyS);
  const currentSpeed = player.sprinting ? player.sprintSpeed : player.speed;
  
  // Get movement direction relative to camera
  const forward = [Math.sin(player.yaw), 0, -Math.cos(player.yaw)];
  const right = [Math.cos(player.yaw), 0, Math.sin(player.yaw)];
  
  let moveDir = [0, 0, 0];
  if (keys.KeyW) { moveDir[0] += forward[0]; moveDir[2] += forward[2]; }
  if (keys.KeyS) { moveDir[0] -= forward[0]; moveDir[2] -= forward[2]; }
  if (keys.KeyD) { moveDir[0] += right[0]; moveDir[2] += right[2]; }
  if (keys.KeyA) { moveDir[0] -= right[0]; moveDir[2] -= right[2]; }
  
  // Normalize diagonal movement
  const len = Math.sqrt(moveDir[0]*moveDir[0] + moveDir[2]*moveDir[2]);
  if (len > 0) {
    moveDir[0] /= len;
    moveDir[2] /= len;
  }
  
  // Apply movement
  player.pos[0] += moveDir[0] * currentSpeed * dt;
  player.pos[2] += moveDir[2] * currentSpeed * dt;
  
  // Weather slow effect
  if (state.weather === 'tornado') {
    player.pos[0] *= (1 - dt * 0.5);
    player.pos[2] *= (1 - dt * 0.5);
  }
  
  // Boundaries
  const bound = FARM_COLS * CELL_SIZE / 2 + 8;
  player.pos[0] = Math.max(-bound, Math.min(bound, player.pos[0]));
  player.pos[2] = Math.max(-bound, Math.min(bound, player.pos[2]));
  player.pos[1] = 1.6; // Fixed height
  
  // Apply camera bob effect (optional)
  if ((keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD) && !state.gameOver) {
    // slight bob would go here
  }
}

// Get camera direction vector
function getForwardVector() {
  return [
    Math.sin(player.yaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(player.yaw) * Math.cos(player.pitch)
  ];
}

// Raycast for targeting
function raycastFarm() {
  const origin = [...player.pos];
  const direction = getForwardVector();
  const maxDist = 5;
  
  for (let t = 0.2; t < maxDist; t += 0.1) {
    const point = [
      origin[0] + direction[0] * t,
      origin[1] + direction[1] * t,
      origin[2] + direction[2] * t
    ];
    
    for (let r = 0; r < FARM_ROWS; r++) {
      for (let c = 0; c < FARM_COLS; c++) {
        const cp = cellPos(c, r);
        const halfSize = CELL_SIZE / 2;
        if (Math.abs(point[0] - cp[0]) < halfSize && 
            Math.abs(point[2] - cp[2]) < halfSize &&
            point[1] > -0.5 && point[1] < 1.5) {
          return { col: c, row: r, point: point };
        }
      }
    }
  }
  return null;
}

// Get farm cell helper
function getFarmCell(col, row) {
  return state.farmGrid.find(c => c.col === col && c.row === row);
}

// ============================================================
// TOOLS & ACTIONS
// ============================================================
function selectTool(tool) {
  state.selectedTool = tool;
  updateToolbar();
}

function updateToolbar() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === state.selectedTool);
  });
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => selectTool(btn.dataset.tool));
});
document.getElementById('shop-toggle-btn').addEventListener('click', toggleShop);

function toggleShop() {
  const panel = document.getElementById('shop-panel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
}

function useTool() {
  const tool = state.selectedTool;
  if (!tool) return;
  
  // Salt throw
  if (tool === 'salt') {
    if (state.saltCount <= 0) {
      notify('No salt! Buy in shop.', 'danger');
      return;
    }
    let killed = false;
    state.enemies = state.enemies.filter(e => {
      if ((e.type === 'slug' || e.type === 'snail') && dist2d(e.pos, player.pos) < 3.5) {
        killed = true;
        spawnParticles(e.pos, [1, 1, 0.6]);
        return false;
      }
      return true;
    });
    if (killed) {
      state.saltCount--;
      notify('Salt killed pest!', 'success');
      updateHUD();
    } else {
      notify('No slugs/snails nearby!', 'danger');
    }
    return;
  }
  
  const hit = raycastFarm();
  if (!hit) {
    notify('Aim at a soil patch!', 'danger');
    return;
  }
  
  const cell = getFarmCell(hit.col, hit.row);
  if (!cell) return;
  
  // Planting seeds
  if (tool.startsWith('seed-')) {
    const type = tool.replace('seed-', '');
    if (state.seeds[type] <= 0) {
      notify(`No ${type} seeds left!`, 'danger');
      return;
    }
    if (cell.hasCrop) {
      notify('Crop already here!', 'danger');
      return;
    }
    if (cell.hasTower) {
      notify('Tower in the way!', 'danger');
      return;
    }
    
    state.seeds[type]--;
    cell.hasCrop = true;
    state.cropCells.push({
      col: hit.col, row: hit.row, type: type,
      growth: 0, stage: 0, hp: 5
    });
    notify(`Planted ${type}!`, 'success');
    updateHUD();
  }
  
  // Placing towers
  if (tool.startsWith('tower-')) {
    const type = tool.replace('tower-', '');
    const tt = TOWER_TYPES[type];
    if (state.money < tt.cost) {
      notify(`Need $${tt.cost} for ${tt.icon}!`, 'danger');
      return;
    }
    if (cell.hasCrop || cell.hasTower) {
      notify('Spot occupied!', 'danger');
      return;
    }
    
    state.money -= tt.cost;
    cell.hasTower = true;
    state.towers.push({
      col: hit.col, row: hit.row, type: type,
      level: 1, cooldown: 0, hp: 20,
      type_data: { ...tt }
    });
    state.selectedTool = null;
    updateToolbar();
    notify(`${tt.icon} tower placed!`, 'success');
    updateHUD();
  }
}

function tryInteract() {
  let closest = null;
  let closestDist = 3.5;
  
  state.cropCells.forEach(crop => {
    if (crop.stage >= 2) {
      const cp = cellPos(crop.col, crop.row);
      const dist = dist2d(player.pos, cp);
      if (dist < closestDist) {
        closestDist = dist;
        closest = crop;
      }
    }
  });
  
  if (closest) {
    const ct = CROP_TYPES[closest.type];
    const value = ct.sellValue;
    state.money += value;
    notify(`Harvested ${ct.icon} for $${value}!`, 'success');
    spawnParticles(cellPos(closest.col, closest.row), ct.color);
    
    const cell = getFarmCell(closest.col, closest.row);
    if (cell) cell.hasCrop = false;
    state.cropCells = state.cropCells.filter(c => c !== closest);
    updateHUD();
  } else {
    notify('No ripe crops nearby! Look for full-grown plants.', 'danger');
  }
}

// ============================================================
// ENEMIES (Simplified but functional)
// ============================================================
const ENEMY_TYPES = {
  slug:   {hp: 15, speed: 0.8, dmg: 0.5, color: [0.5, 0.7, 0.3], size: 0.4},
  snail:  {hp: 25, speed: 0.6, dmg: 0.8, color: [0.6, 0.5, 0.3], size: 0.45},
  rabbit: {hp: 12, speed: 2.0, dmg: 1.0, color: [0.8, 0.7, 0.6], size: 0.4},
};

function spawnEnemy(type) {
  const et = ENEMY_TYPES[type];
  const bound = FARM_COLS * CELL_SIZE / 2 + 5;
  const side = Math.floor(Math.random() * 4);
  let pos;
  if (side === 0) pos = [-bound + Math.random() * bound * 2, 0, -bound];
  else if (side === 1) pos = [-bound + Math.random() * bound * 2, 0, bound];
  else if (side === 2) pos = [-bound, 0, -bound + Math.random() * bound * 2];
  else pos = [bound, 0, -bound + Math.random() * bound * 2];
  
  state.enemies.push({
    type: type, pos: pos, hp: et.hp * (1 + state.wave * 0.1),
    maxHp: et.hp * (1 + state.wave * 0.1), speed: et.speed * (1 + state.wave * 0.05),
    dmg: et.dmg, size: et.size, color: et.color, targetCrop: null
  });
}

function updateEnemies(dt) {
  state.enemies.forEach(e => {
    // Find closest crop
    let closest = null;
    let closestDist = 999;
    state.cropCells.forEach(crop => {
      const cp = cellPos(crop.col, crop.row);
      const dist = dist2d(e.pos, cp);
      if (dist < closestDist) {
        closestDist = dist;
        closest = crop;
      }
    });
    
    if (closest) {
      const targetPos = cellPos(closest.col, closest.row);
      const dir = v3norm(v3sub(targetPos, e.pos));
      e.pos[0] += dir[0] * e.speed * dt;
      e.pos[2] += dir[2] * e.speed * dt;
      
      if (closestDist < 0.8) {
        closest.hp -= e.dmg * dt;
        if (closest.hp <= 0) {
          notify(`A ${e.type} destroyed a crop!`, 'danger');
          const cell = getFarmCell(closest.col, closest.row);
          if (cell) cell.hasCrop = false;
          state.cropCells = state.cropCells.filter(c => c !== closest);
        }
      }
    }
  });
}

function updateTowers(dt) {
  state.towers.forEach(t => {
    t.cooldown -= dt;
    if (t.cooldown > 0) return;
    
    const towerPos = cellPos(t.col, t.row);
    let closestEnemy = null;
    let closestDist = t.type_data.range;
    
    state.enemies.forEach(e => {
      const dist = dist2d(towerPos, e.pos);
      if (dist < closestDist) {
        closestDist = dist;
        closestEnemy = e;
      }
    });
    
    if (closestEnemy) {
      t.cooldown = 1 / t.type_data.rate;
      const dir = v3norm(v3sub(closestEnemy.pos, [towerPos[0], 0.8, towerPos[2]]));
      state.projectiles.push({
        pos: [towerPos[0], 0.8, towerPos[2]],
        vel: [dir[0] * 6, dir[1] * 6, dir[2] * 6],
        dmg: t.type_data.dmg * t.level,
        life: 2,
        color: t.type_data.color
      });
    }
  });
}

function updateProjectiles(dt) {
  state.projectiles = state.projectiles.filter(p => {
    p.pos[0] += p.vel[0] * dt;
    p.pos[1] += p.vel[1] * dt;
    p.pos[2] += p.vel[2] * dt;
    p.life -= dt;
    if (p.life <= 0) return false;
    
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (dist2d(p.pos, e.pos) < 0.6 && Math.abs(p.pos[1] - e.pos[1]) < 0.8) {
        e.hp -= p.dmg;
        spawnParticles(e.pos, [1, 0.5, 0]);
        if (e.hp <= 0) {
          state.enemies.splice(i, 1);
          state.money += 5;
          updateHUD();
        }
        return false;
      }
    }
    return true;
  });
}

function updateCrops(dt) {
  const factor = state.weather === 'drought' ? 0.4 : 1;
  state.cropCells.forEach(c => {
    const ct = CROP_TYPES[c.type];
    c.growth += (dt / ct.growTime) * factor;
    c.stage = c.growth < 0.4 ? 0 : c.growth < 0.8 ? 1 : 2;
  });
}

function spawnParticles(pos, color) {
  for (let i = 0; i < 8; i++) {
    state.particles.push({
      pos: [...pos],
      vel: [(Math.random() - 0.5) * 2, Math.random() * 3, (Math.random() - 0.5) * 2],
      life: 0.8,
      maxLife: 0.8,
      color: color
    });
  }
}

function updateParticles(dt) {
  state.particles = state.particles.filter(p => {
    p.pos[0] += p.vel[0] * dt;
    p.pos[1] += p.vel[1] * dt;
    p.pos[2] += p.vel[2] * dt;
    p.vel[1] -= 4 * dt;
    p.life -= dt;
    return p.life > 0;
  });
}

function updateWaves(dt) {
  if (!state.waveActive) {
    state.waveCooldown -= dt;
    if (state.waveCooldown <= 0) {
      state.waveActive = true;
      const count = 3 + Math.floor(state.wave * 1.5);
      state.waveEnemies = count;
      state.waveSpawnTimer = 0;
      notify(`🌊 Wave ${state.wave} starting! ${count} enemies.`, 'danger');
    }
    return;
  }
  
  state.waveSpawnTimer -= dt;
  if (state.waveSpawnTimer <= 0 && state.waveEnemies > 0) {
    state.waveSpawnTimer = Math.max(0.8, 2 - state.wave * 0.1);
    const types = ['slug', 'snail', 'rabbit'];
    const type = types[Math.floor(Math.random() * Math.min(state.wave, types.length))];
    spawnEnemy(type);
    state.waveEnemies--;
  }
  
  if (state.waveEnemies <= 0 && state.enemies.length === 0) {
    state.waveActive = false;
    state.wave++;
    state.waveCooldown = 10;
    const bonus = 15 + state.wave * 2;
    state.money += bonus;
    notify(`🎉 Wave ${state.wave - 1} cleared! +$${bonus}`, 'success');
    updateHUD();
  }
}

function updateWeather(dt) {
  if (state.weather !== 'clear') {
    state.weatherTimer -= dt;
    if (state.weatherTimer <= 0) {
      state.weather = 'clear';
      document.getElementById('weather-overlay').className = '';
      notify('Weather is clear again!', 'success');
    }
    return;
  }
  
  if (Math.random() < 0.0003 * dt * 60) {
    const type = Math.random() < 0.5 ? 'drought' : 'tornado';
    state.weather = type;
    state.weatherTimer = type === 'drought' ? 20 : 10;
    document.getElementById('weather-overlay').className = type;
    notify(type === 'drought' ? '☀️ DROUGHT! Crops grow slower.' : '🌪️ TORNADO! Movement slowed!', 'weather');
    
    if (type === 'tornado') {
      state.cropCells.forEach(c => { c.hp = Math.max(0, c.hp - 1); });
      state.cropCells = state.cropCells.filter(c => c.hp > 0);
    }
  }
}

function updateDay(dt) {
  state.dayTimer += dt;
  if (state.dayTimer >= state.dayLength) {
    state.dayTimer = 0;
    state.day++;
    state.money += 25;
    notify(`🌅 Day ${state.day} begins! +$25 bonus.`, 'success');
    updateHUD();
  }
}

function checkGameOver() {
  const hasCrops = state.cropCells.length > 0 || 
                   state.seeds.carrot > 0 || 
                   state.seeds.wheat > 0 || 
                   state.seeds.pumpkin > 0;
  const hasMoney = state.money > 0;
  
  if (!hasCrops && !hasMoney && state.enemies.length === 0) {
    state.gameOver = true;
    document.getElementById('game-over').style.display = 'flex';
    document.getElementById('go-score').innerHTML = `Day ${state.day}<br>Wave ${state.wave}<br>Crops lost: ${state.cropCells.length}`;
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function updateHUD() {
  document.getElementById('hud-money').textContent = '$' + Math.floor(state.money);
  document.getElementById('hud-crops').textContent = state.cropCells.length;
  document.getElementById('hud-salt').textContent = state.saltCount;
  document.getElementById('hud-day').textContent = state.day;
  document.getElementById('hud-wave').textContent = state.wave;
}

function notify(msg, type = '') {
  const container = document.getElementById('notifications');
  const notif = document.createElement('div');
  notif.className = 'notif ' + type;
  notif.textContent = msg;
  container.appendChild(notif);
  setTimeout(() => notif.remove(), 3000);
}

// Shop items
function buyItem(item) {
  const costs = {
    'salt': 10,
    'seed-carrot-bulk': 12,
    'seed-wheat-bulk': 20,
    'seed-pumpkin-bulk': 25,
    'tower-cactus': 30,
    'tower-sunflower': 50,
    'tower-rosebush': 70,
  };
  
  const cost = costs[item];
  if (state.money < cost) {
    notify('Not enough money!', 'danger');
    return;
  }
  
  state.money -= cost;
  
  switch(item) {
    case 'salt': state.saltCount += 5; break;
    case 'seed-carrot-bulk': state.seeds.carrot += 3; break;
    case 'seed-wheat-bulk': state.seeds.wheat += 3; break;
    case 'seed-pumpkin-bulk': state.seeds.pumpkin += 2; break;
    case 'tower-cactus': selectTool('tower-cactus'); break;
    case 'tower-sunflower': selectTool('tower-sunflower'); break;
    case 'tower-rosebush': selectTool('tower-rosebush'); break;
  }
  
  notify(`Bought ${item} for $${cost}!`, 'success');
  updateHUD();
}

document.querySelectorAll('.shop-item').forEach(el => {
  el.addEventListener('click', () => buyItem(el.dataset.buy));
});

// ============================================================
// RENDERING
// ============================================================
function getViewMatrix() {
  const eye = v3(player.pos[0], player.pos[1], player.pos[2]);
  const dir = getForwardVector();
  const center = v3add(eye, v3scale(dir, 1));
  return mat4lookAt(eye, center, [0, 1, 0]);
}

function getProjMatrix() {
  return mat4perspective(75 * DEG, canvas.width / canvas.height, 0.1, 100);
}

function getCameraPosition() {
  return player.pos;
}

function render() {
  const view = getViewMatrix();
  const proj = getProjMatrix();
  
  // Sky color
  let skyColor;
  if (state.weather === 'drought') skyColor = [0.7, 0.55, 0.3];
  else if (state.weather === 'tornado') skyColor = [0.3, 0.3, 0.4];
  else skyColor = [0.5, 0.75, 0.9];
  
  gl.clearColor(skyColor[0], skyColor[1], skyColor[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  
  gl.uniform3fv(uLightDir, [0.5, 1, 0.3]);
  gl.uniform1f(uAmbient, 0.45);
  
  // Ground
  const groundMat = mat4scale(50, 0.2, 50);
  const groundMVP = getMVP(view, proj, mat4mul(mat4translate(0, -0.2, 0), groundMat));
  drawMesh(meshes.cube1, groundMVP, groundMat, [0.3, 0.55, 0.2]);
  
  // Farm plots
  for (let r = 0; r < FARM_ROWS; r++) {
    for (let c = 0; c < FARM_COLS; c++) {
      const cp = cellPos(c, r);
      const plotMat = mat4mul(mat4translate(cp[0], 0, cp[2]), mat4scale(CELL_SIZE - 0.4, 0.1, CELL_SIZE - 0.4));
      const plotMVP = getMVP(view, proj, plotMat);
      drawMesh(meshes.cube1, plotMVP, plotMat, [0.45, 0.3, 0.15]);
    }
  }
  
  // Crops
  state.cropCells.forEach(crop => {
    const cp = cellPos(crop.col, crop.row);
    const ct = CROP_TYPES[crop.type];
    const height = 0.2 + crop.growth * 0.8;
    
    // Stem
    const stemMat = mat4mul(mat4translate(cp[0], 0.05, cp[2]), mat4scale(1, height, 1));
    drawMesh(meshes.stalk, getMVP(view, proj, stemMat), stemMat, [0.2, 0.6, 0.1]);
    
    // Head
    if (crop.stage >= 1) {
      const headMat = mat4mul(mat4translate(cp[0], 0.05 + height, cp[2]), mat4scale(0.6 + crop.growth * 0.4, 0.4, 0.6 + crop.growth * 0.4));
      drawMesh(meshes.ball, getMVP(view, proj, headMat), headMat, ct.color);
    }
  });
  
  // Towers
  state.towers.forEach(t => {
    const cp = cellPos(t.col, t.row);
    const tt = t.type_data;
    
    // Base
    const baseMat = mat4mul(mat4translate(cp[0], 0.1, cp[2]), mat4scale(0.6, 0.8, 0.6));
    drawMesh(meshes.trunk, getMVP(view, proj, baseMat), baseMat, tt.color);
    
    // Top
    const topMat = mat4mul(mat4translate(cp[0], 0.9, cp[2]), mat4scale(0.8, 0.5, 0.8));
    drawMesh(meshes.ball, getMVP(view, proj, topMat), topMat, tt.color.map(c => c * 0.8));
  });
  
  // Enemies
  state.enemies.forEach(e => {
    const enemyMat = mat4mul(mat4translate(e.pos[0], e.pos[1], e.pos[2]), mat4scale(e.size, e.size, e.size));
    drawMesh(meshes.enemy, getMVP(view, proj, enemyMat), enemyMat, e.color);
    
    // Health bar
    const healthPercent = e.hp / e.maxHp;
    const healthMat = mat4mul(mat4translate(e.pos[0] - 0.5, e.pos[1] + 0.6, e.pos[2]), mat4scale(healthPercent, 0.1, 0.1));
    drawMesh(meshes.cube1, getMVP(view, proj, healthMat), healthMat, [0.2, 0.8, 0.2]);
  });
  
  // Projectiles
  state.projectiles.forEach(p => {
    const projMat = mat4translate(p.pos[0], p.pos[1], p.pos[2]);
    drawMesh(meshes.projectile, getMVP(view, proj, projMat), projMat, [1, 0.8, 0]);
  });
  
  // Particles
  state.particles.forEach(p => {
    const size = 0.1 * (p.life / p.maxLife);
    const partMat = mat4mul(mat4translate(p.pos[0], p.pos[1], p.pos[2]), mat4scale(size, size, size));
    drawMesh(meshes.cube0_3, getMVP(view, proj, partMat), partMat, p.color);
  });
}

// ============================================================
// GAME LOOP
// ============================================================
let lastTime = 0;
let frameCount = 0;

function gameLoop(currentTime) {
  const dt = Math.min(0.033, (currentTime - lastTime) / 1000);
  lastTime = currentTime;
  
  if (!state.gameOver && dt > 0) {
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
  requestAnimationFrame(gameLoop);
}

// ============================================================
// INITIALIZATION
// ============================================================
document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('intro-screen').style.display = 'none';
  initState();
  updateHUD();
  canvas.requestPointerLock();
  lastTime = performance.now();
  requestAnimationFrame(gameLoop);
  notify('🌱 Welcome to Garden Defense! Plant seeds and defend your farm!', 'success');
});

document.getElementById('restart-btn').addEventListener('click', () => {
  document.getElementById('game-over').style.display = 'none';
  initState();
  updateHUD();
  canvas.requestPointerLock();
  notify('🌱 Fresh start! Good luck!', 'success');
});

// Intro screen render
function renderIntro() {
  gl.clearColor(0.1, 0.2, 0.1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  requestAnimationFrame(renderIntro);
}
renderIntro();
