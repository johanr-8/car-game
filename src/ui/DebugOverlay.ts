/**
 * src/ui/DebugOverlay.ts
 * ─────────────────────────────────────────────────────────────
 * F3-toggleable HUD and Continuous Dev-Only Performance Profiler.
 *
 * Features:
 *   - Real-time HUD showing FPS, frame time, p50/p99, draw calls, triangles, heap
 *   - Logs p50/p99 frame times, draw calls, triangles, and JS heap every 10 seconds
 *   - 5-minute session summary automatically printed to console
 *   - Global window.printProfileSummary() command for on-demand console inspection
 *
 * RULES.md: Zero per-frame allocations. All DOM nodes cached.
 * ─────────────────────────────────────────────────────────────
 */
import type { StatsCollector } from '../core/StatsCollector';
import { isDevMode } from '../core/DevMode';
import type * as THREE from 'three';

export interface ProfileSnapshot {
  timestampSec: number;
  p50Ms: number;
  p99Ms: number;
  avgFps: number;
  drawCalls: number;
  triangles: number;
  usedHeapMb: number | null;
}

export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private visible = false;

  // Individual label elements (pre-created, text updated in-place)
  private readonly elFps:    HTMLSpanElement;
  private readonly elFt:     HTMLSpanElement;
  private readonly elP50P99: HTMLSpanElement;
  private readonly elDc:     HTMLSpanElement;
  private readonly elTri:    HTMLSpanElement;
  private readonly elTicks:  HTMLSpanElement;
  private readonly elHeap:   HTMLSpanElement;
  private readonly elGrav:   HTMLSpanElement;
  private readonly elChunks: HTMLSpanElement;
  private readonly elBuild:  HTMLSpanElement;
  private readonly elSurf:   HTMLSpanElement;
  private readonly elRoadQueries: HTMLSpanElement;
  private readonly elAllocs:      HTMLSpanElement;

  // ── Profiling Metrics Buffer (Zero GC per frame) ────────────
  private readonly windowSamples = new Float32Array(2400); // Up to 2400 frames per 10s (~240 Hz headroom)
  private sampleCount = 0;
  private windowTimer = 0;
  private sessionTimer = 0;
  private hasLogged5MinSummary = false;

  private lastP50 = 0;
  private lastP99 = 0;
  private readonly snapshots: ProfileSnapshot[] = [];

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position:       'fixed',
      top:            '12px',
      left:           '12px',
      padding:        '10px 16px',
      background:     'rgba(5, 5, 20, 0.85)',
      border:         '1px solid #00f0ff',
      borderRadius:   '8px',
      color:          '#00f0ff',
      fontFamily:     'ui-monospace, SFMono-Regular, "Courier New", monospace',
      fontSize:       '12px',
      lineHeight:     '1.6',
      pointerEvents:  'none',
      display:        'none',
      zIndex:         '9999',
      backdropFilter: 'blur(6px)',
      boxShadow:      '0 4px 16px rgba(0,0,0,0.4)',
    } as Partial<CSSStyleDeclaration>);

    const makeRow = (label: string): HTMLSpanElement => {
      const row = document.createElement('div');
      const span = document.createElement('span');
      row.textContent = label + ' ';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.gap = '12px';
      span.style.fontWeight = 'bold';
      span.style.color = '#ffffff';
      row.appendChild(span);
      this.root.appendChild(row);
      return span;
    };

    // Title
    const title = document.createElement('div');
    title.textContent = '── WARP PROFILER HUD ──';
    title.style.color = '#e879f9';
    title.style.fontWeight = '900';
    title.style.letterSpacing = '1px';
    title.style.marginBottom = '6px';
    title.style.textAlign = 'center';
    this.root.appendChild(title);

    this.elFps    = makeRow('FPS        :');
    this.elFt     = makeRow('Frame Time :');
    this.elP50P99 = makeRow('p50 / p99  :');
    this.elDc     = makeRow('Draw Calls :');
    this.elTri    = makeRow('Triangles  :');
    this.elTicks  = makeRow('Phys Ticks :');
    this.elHeap   = makeRow('JS Heap    :');
    this.elGrav   = makeRow('Surface N  :');
    this.elSurf   = makeRow('Surface    :');
    this.elChunks = makeRow('Chunks     :');
    this.elBuild  = makeRow('Build ms   :');
    this.elRoadQueries = makeRow('Road queries/tick:');
    this.elAllocs      = makeRow('Unavoidable allocs:');

    const hint = document.createElement('div');
    hint.textContent = '[F3] toggle | auto-profile: 10s log';
    hint.style.color = '#64748b';
    hint.style.marginTop = '6px';
    hint.style.fontSize = '10px';
    hint.style.textAlign = 'center';
    this.root.appendChild(hint);

    document.body.appendChild(this.root);

    // F3 toggle (only enabled in dev mode)
    window.addEventListener('keydown', e => {
      if (e.code === 'F3' && isDevMode()) {
        e.preventDefault();
        this.toggle();
      }
    });

    // Expose global developer summary command
    (window as any).printProfileSummary = () => this.printSummary();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  show(): void  { this.visible = true;  this.root.style.display = 'block'; }
  hide(): void  { this.visible = false; this.root.style.display = 'none'; }
  get isVisible(): boolean { return this.visible; }

  getSnapshots(): readonly ProfileSnapshot[] {
    return this.snapshots;
  }

  reset(): void {
    this.snapshots.length = 0;
    this.sampleCount = 0;
    this.windowTimer = 0;
    this.sessionTimer = 0;
    this.hasLogged5MinSummary = false;
    this.lastP50 = 0;
    this.lastP99 = 0;
  }

  /**
   * Continuous profiling update called once per rendered frame.
   * Zero per-frame heap allocations.
   */
  update(stats: StatsCollector, renderer: THREE.WebGLRenderer, dt: number): void {
    const frameMs = stats.avgFrameMs;

    // Record sample into window circular buffer
    if (this.sampleCount < this.windowSamples.length) {
      this.windowSamples[this.sampleCount++] = frameMs;
    }

    this.windowTimer += dt;
    this.sessionTimer += dt;

    // ── 10-Second Profiler Aggregation & Logging ─────────────
    if (this.windowTimer >= 10.0 && this.sampleCount > 0) {
      // Sort slice to compute percentiles
      const slice = Array.from(this.windowSamples.subarray(0, this.sampleCount)).sort((a, b) => a - b);
      const p50 = slice[Math.floor(slice.length * 0.50)] || 0;
      const p99 = slice[Math.floor(slice.length * 0.99)] || 0;
      this.lastP50 = p50;
      this.lastP99 = p99;

      const mem = (performance as any).memory;
      const usedHeapMb = mem ? +(mem.usedJSHeapSize / (1024 * 1024)).toFixed(1) : null;
      const heapStr = usedHeapMb !== null ? `${usedHeapMb} MB` : 'N/A';

      const dc = renderer.info.render.calls;
      const tri = renderer.info.render.triangles;
      const avgFps = stats.fps;

      const snapshot: ProfileSnapshot = {
        timestampSec: Math.round(this.sessionTimer),
        p50Ms: +p50.toFixed(2),
        p99Ms: +p99.toFixed(2),
        avgFps: +avgFps.toFixed(1),
        drawCalls: dc,
        triangles: tri,
        usedHeapMb,
      };
      this.snapshots.push(snapshot);

      if (this.visible || (import.meta as any).env?.DEV) {
        console.log(
          `%c[WARP PROFILER - ${snapshot.timestampSec}s]%c p50: ${p50.toFixed(2)}ms | p99: ${p99.toFixed(2)}ms | FPS: ${avgFps.toFixed(1)} | DrawCalls: ${dc} | Triangles: ${tri.toLocaleString()} | Heap: ${heapStr}`,
          'color:#00f0ff;font-weight:bold;',
          'color:#e2e8f0;'
        );
      }

      this.sampleCount = 0;
      this.windowTimer = 0;
    }

    // ── 5-Minute Session Summary (300 seconds) ───────────────
    if (this.sessionTimer >= 300.0 && !this.hasLogged5MinSummary) {
      this.hasLogged5MinSummary = true;
      console.log('%c══════════════════ 5-MINUTE SESSION PROFILE SUMMARY ══════════════════', 'color:#38bdf8;font-weight:bold;');
      this.printSummary();
    }

    // ── Update Live HUD UI ───────────────────────────────────
    if (!this.visible) return;

    this.elFps.textContent    = stats.fps.toFixed(1);
    this.elFt.textContent     = stats.avgFrameMs.toFixed(2) + ' ms';
    this.elP50P99.textContent = `${this.lastP50.toFixed(1)} / ${this.lastP99.toFixed(1)} ms`;
    this.elDc.textContent     = String(renderer.info.render.calls);
    this.elTri.textContent    = renderer.info.render.triangles.toLocaleString();
    this.elTicks.textContent  = String(stats.ticksThisFrame);

    const mem = (performance as any).memory;
    this.elHeap.textContent   = mem ? `${(mem.usedJSHeapSize / (1024 * 1024)).toFixed(1)} MB` : 'N/A';
    this.elGrav.textContent   = stats.gravityLabel;
    this.elSurf.textContent   = stats.surfaceLabel;
    this.elChunks.textContent = String(stats.loadedChunks);
    this.elBuild.textContent  = stats.chunkBuildMs > 0 ? `${stats.chunkBuildMs.toFixed(2)} ms` : 'idle';
    this.elRoadQueries.textContent = String(stats.roadQueriesPerTick);
    this.elAllocs.textContent = String(stats.unavoidableAllocs);
  }

  /**
   * Prints comprehensive structured session summary to console.
   * Can be invoked anytime via window.printProfileSummary().
   */
  printSummary(): void {
    if (this.snapshots.length === 0) {
      console.warn('[WARP PROFILER] No profile snapshots recorded yet. Wait at least 10 seconds.');
      return;
    }

    const p50s = this.snapshots.map(s => s.p50Ms).sort((a, b) => a - b);
    const p99s = this.snapshots.map(s => s.p99Ms).sort((a, b) => a - b);
    const fps = this.snapshots.map(s => s.avgFps);
    const maxDc = Math.max(...this.snapshots.map(s => s.drawCalls));
    const maxTri = Math.max(...this.snapshots.map(s => s.triangles));

    const medianP50 = p50s[Math.floor(p50s.length * 0.5)];
    const worstP99  = p99s[p99s.length - 1];
    const avgFpsVal = fps.reduce((a, b) => a + b, 0) / fps.length;
    const minFpsVal = Math.min(...fps);
    const maxFpsVal = Math.max(...fps);

    const heaps = this.snapshots.map(s => s.usedHeapMb).filter((h): h is number => h !== null);
    const initialHeap = heaps.length > 0 ? heaps[0] : null;
    const peakHeap    = heaps.length > 0 ? Math.max(...heaps) : null;
    const currentHeap = heaps.length > 0 ? heaps[heaps.length - 1] : null;

    console.group('%c🏎️ Warp City Engine: Session Performance Audit', 'color:#ffd700;font-size:14px;font-weight:bold;');
    console.log(`⏱️ Duration Recorded : ${(this.sessionTimer / 60).toFixed(1)} minutes (${this.snapshots.length} 10s windows)`);
    console.log(`⚡ Frame Times       : Median p50 = ${medianP50.toFixed(2)} ms | Worst p99 = ${worstP99.toFixed(2)} ms`);
    console.log(`🎯 Framerate (FPS)   : Avg = ${avgFpsVal.toFixed(1)} | Min = ${minFpsVal.toFixed(1)} | Max = ${maxFpsVal.toFixed(1)}`);
    console.log(`🎨 Render Budget     : Peak Draw Calls = ${maxDc} / 200 target | Peak Triangles = ${maxTri.toLocaleString()}`);

    if (initialHeap !== null && peakHeap !== null && currentHeap !== null) {
      const heapDelta = (currentHeap - initialHeap).toFixed(2);
      console.log(`🧠 Memory (JS Heap)  : Start = ${initialHeap} MB | Peak = ${peakHeap} MB | Current = ${currentHeap} MB (Delta: ${heapDelta} MB)`);
    } else {
      console.log('🧠 Memory (JS Heap)  : Performance memory API not supported in this browser engine');
    }

    console.table(this.snapshots);
    console.groupEnd();
  }
}
