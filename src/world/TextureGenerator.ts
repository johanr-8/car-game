/**
 * src/world/TextureGenerator.ts
 * ─────────────────────────────────────────────────────────────
 * Instant procedural canvas textures for real-life urban materials:
 *   - Asphalt road texture with realistic aggregate grit and tire wear
 *   - Skyscraper facade textures with architectural window grids & mullions
 *   - Lush turf park grass texture with fine organic fibers
 *   - Concrete plaza & pavement stipple textures
 *
 * Zero external asset dependencies. Instantaneous loading.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';

let cachedAsphaltTex: THREE.CanvasTexture | null = null;
let cachedGrassTex: THREE.CanvasTexture | null = null;
let cachedTerrainDetailTex: THREE.CanvasTexture | null = null;
let cachedPlazaTex: THREE.CanvasTexture | null = null;
let cachedBrickTex: THREE.CanvasTexture | null = null;
let cachedWarehouseTex: THREE.CanvasTexture | null = null;
let cachedHouseTex: THREE.CanvasTexture | null = null;
const cachedBuildingTextures: (THREE.CanvasTexture | null)[] = [null, null, null, null];

/**
 * Realistic Asphalt Road Tarmac Texture (512x512)
 */
export function getAsphaltTexture(): THREE.CanvasTexture {
  if (cachedAsphaltTex) return cachedAsphaltTex;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base charcoal asphalt
  ctx.fillStyle = '#262a33';
  ctx.fillRect(0, 0, 512, 512);

  // Gravel grit specks
  for (let i = 0; i < 18000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() > 0.8 ? 2 : 1;
    const shade = Math.random() > 0.5 ? '#1a1d24' : '#383e4c';
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, size, size);
  }

  // Subtle tire groove / wear lines
  ctx.fillStyle = 'rgba(20, 24, 30, 0.25)';
  for (let y = 0; y < 512; y += 4) {
    if (Math.random() > 0.4) {
      ctx.fillRect(0, y, 512, 1);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 32);
  cachedAsphaltTex = tex;
  return tex;
}

/**
 * Tiling Dual-Frequency Terrain Detail Texture (512x512)
 * Combines two incommensurate noise frequencies (~73px & ~17px) with fine mineral grain
 * to break up grid repetition completely across sand, grass, dirt, and rock biomes.
 */
export function getTerrainDetailTexture(): THREE.CanvasTexture {
  if (cachedTerrainDetailTex) return cachedTerrainDetailTex;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  if (ctx && typeof ctx.createImageData === 'function') {
    const imgData = ctx.createImageData(512, 512);
    const data = imgData.data;

    // Dual-frequency procedural value noise synthesis
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        // Frequency 1 (macro organic variation, wavelength ~73px)
        const w1 = Math.sin(x * 0.086 + y * 0.041) * Math.cos(y * 0.079 - x * 0.035);
        // Frequency 2 (fine surface turbulence, wavelength ~17px)
        const w2 = Math.sin(x * 0.37 + y * 0.28) * Math.cos(y * 0.33 - x * 0.25);
        // High-frequency granular stippling
        const grain = (Math.random() - 0.5) * 0.16;

        const val = Math.max(0, Math.min(255, Math.round(128 + (w1 * 0.22 + w2 * 0.14 + grain) * 255)));

        const idx = (y * 512 + x) * 4;
        data[idx]     = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }

    if (typeof ctx.putImageData === 'function') {
      ctx.putImageData(imgData, 0, 0);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(64, 64);
  cachedTerrainDetailTex = tex;
  return tex;
}

/**
 * Lush Green Park Lawn Turf Texture (256x256)
 */
export function getGrassTexture(): THREE.CanvasTexture {
  if (cachedGrassTex) return cachedGrassTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base vibrant lawn green
  ctx.fillStyle = '#34662b';
  ctx.fillRect(0, 0, 256, 256);

  // Organic grass blade fibers
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const shade = Math.random() > 0.5 ? '#2c5724' : '#417d35';
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, 1, Math.random() * 3 + 1);
  }

  // Subtle mowing stripes
  ctx.fillStyle = 'rgba(75, 140, 60, 0.12)';
  for (let x = 0; x < 256; x += 32) {
    ctx.fillRect(x, 0, 16, 256);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  cachedGrassTex = tex;
  return tex;
}

/**
 * Paved Concrete Plaza & Sidewalk Texture (256x256)
 */
export function getPlazaTexture(): THREE.CanvasTexture {
  if (cachedPlazaTex) return cachedPlazaTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#b0b8c4';
  ctx.fillRect(0, 0, 256, 256);

  // Concrete pavers grid
  ctx.strokeStyle = '#8d96a5';
  ctx.lineWidth = 2;
  const tileSize = 32;
  for (let x = 0; x <= 256; x += tileSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y <= 256; y += tileSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  // Stipple grain
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.fillStyle = Math.random() > 0.5 ? '#9fa9b8' : '#c2cbd7';
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  cachedPlazaTex = tex;
  return tex;
}

/**
 * Skyscraper Architectural Facade Texture with Window Grids & Spandrels
 */
export function getBuildingTexture(style: number): THREE.CanvasTexture {
  if (cachedBuildingTextures[style]) return cachedBuildingTextures[style]!;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const styleConfigs = [
    // 0: Modern White Panel Tower
    { base: '#dbe1ec', frame: '#707a8a', glass: '#3a506b', spandrel: '#94a3b8' },
    // 1: Blue Reflective Curtain-Wall Tower
    { base: '#1e3a5f', frame: '#0f172a', glass: '#4895ef', spandrel: '#1e293b' },
    // 2: Warm Classical Limestone
    { base: '#d7cabb', frame: '#8c7d6b', glass: '#2d3748', spandrel: '#b8a896' },
    // 3: Dark Slate High-Tech Steel
    { base: '#1e2430', frame: '#0b0f17', glass: '#38bdf8', spandrel: '#2d3748' },
  ];
  const cfg = styleConfigs[style] || styleConfigs[0];

  // Base facade panel
  ctx.fillStyle = cfg.base;
  ctx.fillRect(0, 0, 256, 512);

  // Architectural Window Grid
  const cols = 8;
  const rows = 16;
  const cellW = 256 / cols;
  const cellH = 512 / rows;
  const winPadX = 5;
  const winPadY = 6;

  for (let r = 0; r < rows; r++) {
    // Spandrel floor beam
    ctx.fillStyle = cfg.spandrel;
    ctx.fillRect(0, r * cellH, 256, 3);

    for (let c = 0; c < cols; c++) {
      const wx = c * cellW + winPadX;
      const wy = r * cellH + winPadY;
      const ww = cellW - winPadX * 2;
      const wh = cellH - winPadY * 2;

      // Window Frame
      ctx.fillStyle = cfg.frame;
      ctx.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);

      // Glass Pane (with subtle gradient and internal office reflection)
      const isLit = Math.random() > 0.45;
      ctx.fillStyle = isLit ? cfg.glass : '#111827';
      ctx.fillRect(wx, wy, ww, wh);

      // Reflection highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(wx, wy, ww * 0.45, wh);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 8);
  cachedBuildingTextures[style] = tex;
  return tex;
}

/**
 * Traditional Red/Brown Brick Facade Texture with Mortar & Windows (256x512)
 */
export function getBrickTexture(): THREE.CanvasTexture {
  if (cachedBrickTex) return cachedBrickTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base brick color
  ctx.fillStyle = '#8f3d32';
  ctx.fillRect(0, 0, 256, 512);

  // Brick rows & mortar courses
  ctx.strokeStyle = '#d4cec5';
  ctx.lineWidth = 1;
  const rowH = 8;
  const brickW = 16;
  for (let y = 0; y < 512; y += rowH) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();

    const isOffset = (y / rowH) % 2 === 1;
    const startX = isOffset ? -brickW / 2 : 0;
    for (let x = startX; x < 256; x += brickW) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + rowH);
      ctx.stroke();
    }
  }

  // Windows with white stone lintels and sills
  const cols = 6;
  const rows = 12;
  const colStep = 256 / cols;
  const rowStep = 512 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = c * colStep + 8;
      const wy = r * rowStep + 10;
      const ww = colStep - 16;
      const wh = rowStep - 18;

      // Stone lintel (top)
      ctx.fillStyle = '#ece8e1';
      ctx.fillRect(wx - 2, wy - 3, ww + 4, 3);
      // Stone sill (bottom)
      ctx.fillRect(wx - 2, wy + wh, ww + 4, 3);

      // Window Frame & Glass
      ctx.fillStyle = '#22262f';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = Math.random() > 0.4 ? '#38bdf8' : '#1e293b';
      ctx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 8);
  cachedBrickTex = tex;
  return tex;
}

/**
 * Industrial Corrugated Metal Warehouse Texture with Roll-up Bay Doors (256x256)
 */
export function getWarehouseTexture(): THREE.CanvasTexture {
  if (cachedWarehouseTex) return cachedWarehouseTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Corrugated steel base
  ctx.fillStyle = '#64748b';
  ctx.fillRect(0, 0, 256, 256);

  // Corrugation ribs
  for (let x = 0; x < 256; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? '#475569' : '#94a3b8';
    ctx.fillRect(x, 0, 2, 256);
  }

  // Large roll-up freight bay door in lower half
  ctx.fillStyle = '#334155';
  ctx.fillRect(32, 120, 192, 136);

  // Door slats
  ctx.fillStyle = '#1e293b';
  for (let y = 120; y < 256; y += 6) {
    ctx.fillRect(32, y, 192, 2);
  }

  // Yellow & black hazard threshold stripe
  ctx.fillStyle = '#facc15';
  ctx.fillRect(32, 250, 192, 6);
  ctx.fillStyle = '#0f172a';
  for (let x = 32; x < 224; x += 16) {
    ctx.fillRect(x, 250, 8, 6);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  cachedWarehouseTex = tex;
  return tex;
}

/**
 * Suburban Residential House Siding Texture with Windows & Door (256x256)
 */
export function getHouseTexture(): THREE.CanvasTexture {
  if (cachedHouseTex) return cachedHouseTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Warm siding base
  ctx.fillStyle = '#e8ecf2';
  ctx.fillRect(0, 0, 256, 256);

  // Horizontal lap siding boards
  ctx.fillStyle = '#cbd5e1';
  for (let y = 0; y < 256; y += 8) {
    ctx.fillRect(0, y, 256, 1);
  }

  // Upper Windows
  const winColor = '#38bdf8';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(36, 40, 52, 64);
  ctx.fillRect(168, 40, 52, 64);

  ctx.fillStyle = winColor;
  ctx.fillRect(40, 44, 44, 56);
  ctx.fillRect(172, 44, 44, 56);

  // Window mullions (cross)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(61, 44, 2, 56);
  ctx.fillRect(40, 71, 44, 2);
  ctx.fillRect(193, 44, 2, 56);
  ctx.fillRect(172, 71, 44, 2);

  // Front Entrance Door (ground level)
  ctx.fillStyle = '#1e3a5f';
  ctx.fillRect(108, 148, 40, 108);
  // White door casing
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(108, 148, 40, 108);
  } else if (typeof ctx.stroke === 'function' && typeof ctx.rect === 'function') {
    ctx.beginPath?.();
    ctx.rect(108, 148, 40, 108);
    ctx.stroke();
  }
  // Brass doorknob
  ctx.fillStyle = '#f59e0b';
  if (typeof ctx.arc === 'function') {
    ctx.beginPath?.();
    ctx.arc(140, 204, 3, 0, Math.PI * 2);
    ctx.fill?.();
  } else {
    ctx.fillRect(138, 202, 4, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  cachedHouseTex = tex;
  return tex;
}

let cachedSidewalkTex: THREE.CanvasTexture | null = null;
const cachedBillboardTextures: (THREE.CanvasTexture | null)[] = [null, null, null, null];
let cachedGantryTex: THREE.CanvasTexture | null = null;

/**
 * Modern Urban Concrete Sidewalk Pavers Texture (256x256)
 */
export function getConcreteSidewalkTexture(): THREE.CanvasTexture {
  if (cachedSidewalkTex) return cachedSidewalkTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base urban concrete
  ctx.fillStyle = '#a6b0be';
  ctx.fillRect(0, 0, 256, 256);

  // Square sidewalk paver slab seams
  ctx.strokeStyle = '#8590a2';
  ctx.lineWidth = 3;
  const tileSize = 64;
  for (let x = 0; x <= 256; x += tileSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y <= 256; y += tileSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  // Stone grain & speckled concrete stipple
  for (let i = 0; i < 3500; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.fillStyle = Math.random() > 0.5 ? '#939dae' : '#b8c3d2';
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 16);
  cachedSidewalkTex = tex;
  return tex;
}

function safeStrokeRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(x, y, w, h);
  } else if (typeof ctx.stroke === 'function') {
    ctx.beginPath?.();
    ctx.rect?.(x, y, w, h);
    ctx.stroke();
  }
}

function safeFillText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  if (typeof ctx.fillText === 'function') {
    ctx.fillText(text, x, y);
  }
}

/**
 * Cyberpunk Glowing Holographic Neon Billboard Texture (512x256)
 */
export function getNeonBillboardTexture(style: number): THREE.CanvasTexture {
  const idx = style % 4;
  if (cachedBillboardTextures[idx]) return cachedBillboardTextures[idx]!;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Deep obsidian night backdrop
  ctx.fillStyle = '#080a12';
  ctx.fillRect(0, 0, 512, 256);

  // Subtle digital grid overlay
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y <= 256; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  if (idx === 0) {
    // Neon Cyberpunk "WARP // SPEED" (Magenta + Cyan)
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 8;
    safeStrokeRect(ctx, 12, 12, 488, 232);

    ctx.fillStyle = '#ff007f';
    ctx.font = '900 64px -apple-system, sans-serif';
    safeFillText(ctx, 'WARP SPEED', 40, 110);

    ctx.fillStyle = '#00f0ff';
    ctx.font = '700 28px monospace';
    safeFillText(ctx, '超音速 // GRAVITY VELOCITY', 44, 160);

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 18px monospace';
    safeFillText(ctx, 'SEC-09 /// NITRO CHARGED', 44, 200);
  } else if (idx === 1) {
    // "NEO-DRIFT" (Laser Lime + Gold)
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 8;
    safeStrokeRect(ctx, 12, 12, 488, 232);

    ctx.fillStyle = '#39ff14';
    ctx.font = '900 62px -apple-system, sans-serif';
    safeFillText(ctx, 'NEO-DRIFT', 40, 105);

    ctx.fillStyle = '#ffd700';
    ctx.font = '700 32px monospace';
    safeFillText(ctx, '⚡ 6DOF KINETICS // TOKYO', 44, 158);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 18px monospace';
    safeFillText(ctx, 'LATERAL ADHESION ACTIVE', 44, 200);
  } else if (idx === 2) {
    // "APEX // DOWNTOWN" (Electric Violet + Blaze Orange)
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 8;
    safeStrokeRect(ctx, 12, 12, 488, 232);

    ctx.fillStyle = '#f97316';
    ctx.font = '900 60px -apple-system, sans-serif';
    safeFillText(ctx, 'APEX OVERDRIVE', 36, 105);

    ctx.fillStyle = '#8b5cf6';
    ctx.font = '700 28px monospace';
    safeFillText(ctx, 'METROPOLIS CIRCUIT 01', 40, 155);

    ctx.fillStyle = '#34d399';
    ctx.font = '600 18px monospace';
    safeFillText(ctx, 'LIMITLESS HORIZON // 2077', 40, 198);
  } else {
    // "CYBER HYPERSPEED" (Cyan + Neon Red)
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 8;
    safeStrokeRect(ctx, 12, 12, 488, 232);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '900 60px -apple-system, sans-serif';
    safeFillText(ctx, 'HYPER-BOOST', 40, 105);

    ctx.fillStyle = '#f43f5e';
    ctx.font = '700 30px monospace';
    safeFillText(ctx, 'NITROUS PROTOCOL // 99%', 44, 155);

    ctx.fillStyle = '#facc15';
    ctx.font = '600 18px monospace';
    safeFillText(ctx, 'APEX TOWER SKYWAY ACCESS', 44, 198);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  cachedBillboardTextures[idx] = tex;
  return tex;
}

/**
 * Overhead Digital Highway Gantry Sign Board Texture (512x128)
 */
export function getGantryTexture(): THREE.CanvasTexture {
  if (cachedGantryTex) return cachedGantryTex;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  // Highway sign green-cyan reflective base
  ctx.fillStyle = '#064e3b';
  ctx.fillRect(0, 0, 512, 128);

  // Border outline
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 6;
  safeStrokeRect(ctx, 8, 8, 496, 112);

  // Directional text & arrows
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 34px -apple-system, sans-serif';
  safeFillText(ctx, 'HIGHWAY 101 ↑  DOWNTOWN', 28, 54);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '700 22px monospace';
  safeFillText(ctx, 'SPEED LIMIT: 300 KM/H  •  RADAR ON', 32, 94);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  cachedGantryTex = tex;
  return tex;
}
