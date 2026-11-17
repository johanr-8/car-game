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
let cachedPlazaTex: THREE.CanvasTexture | null = null;
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
