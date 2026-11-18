/**
 * src/ui/LoadingScreen.ts
 * ─────────────────────────────────────────────────────────────
 * Loading Overlay with GPU Shader Warm-Up.
 * Compiles all materials and renders one off-screen frame before
 * countdown begins, eliminating shader compilation stutter during gameplay.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';

export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly statusText: HTMLDivElement;
  private readonly progressBar: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position:        'fixed',
      top:             '0',
      left:            '0',
      width:           '100vw',
      height:          '100vh',
      background:      '#030712',
      display:         'none',
      flexDirection:   'column',
      justifyContent:  'center',
      alignItems:      'center',
      zIndex:          '9900',
      pointerEvents:   'auto',
      fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color:           '#ffffff',
      transition:      'opacity 0.3s ease',
      opacity:         '1',
    } as Partial<CSSStyleDeclaration>);

    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;max-width:400px;width:80%;';

    const title = document.createElement('div');
    title.innerHTML = `
      <div style="font-size:11px;font-weight:800;letter-spacing:3px;color:#38bdf8;text-transform:uppercase;">Warp City</div>
      <div style="font-size:24px;font-weight:950;letter-spacing:2px;color:#ffffff;margin-top:2px;">VELOCITY DRIFT</div>
    `;
    content.appendChild(title);

    // Animated glow track progress bar
    const barTrack = document.createElement('div');
    barTrack.style.cssText = 'width:100%;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;position:relative;';

    this.progressBar = document.createElement('div');
    this.progressBar.style.cssText = 'width:0%;height:100%;background:linear-gradient(90deg, #38bdf8, #0284c7);border-radius:2px;transition:width 0.2s ease;box-shadow:0 0 10px #38bdf8;';
    barTrack.appendChild(this.progressBar);
    content.appendChild(barTrack);

    this.statusText = document.createElement('div');
    this.statusText.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:1px;color:#94a3b8;font-family:monospace;';
    this.statusText.textContent = 'WARMING UP GPU SHADERS...';
    content.appendChild(this.statusText);

    this.root.appendChild(content);
    document.body.appendChild(this.root);
  }

  show(text: string = 'WARMING UP GPU SHADERS...'): void {
    this.statusText.textContent = text;
    this.progressBar.style.width = '20%';
    this.root.style.opacity = '1';
    this.root.style.display = 'flex';
  }

  /**
   * Compiles all scene materials and renders one off-screen frame.
   */
  async warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
    this.show('WARMING UP GPU SHADERS...');

    // Small delay to let browser render loading overlay
    await new Promise(r => requestAnimationFrame(r));
    this.progressBar.style.width = '60%';

    try {
      // 1. Compile all shaders
      renderer.compile(scene, camera);

      // 2. Render single warm-up frame to force pipeline state creation
      renderer.render(scene, camera);
    } catch {
      // Ignore if headless or context lost
    }

    this.progressBar.style.width = '100%';
    this.statusText.textContent = 'SYSTEMS READY!';

    await new Promise(r => setTimeout(r, 80));
    await this.fadeOut();
  }

  private fadeOut(): Promise<void> {
    return new Promise(resolve => {
      this.root.style.opacity = '0';
      setTimeout(() => {
        this.root.style.display = 'none';
        resolve();
      }, 300);
    });
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
