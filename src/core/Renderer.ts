/**
 * src/core/Renderer.ts
 * Sets up the WebGL2 renderer with soft directional shadows and ACES tonemapping.
 */
import * as THREE from 'three';
import { BG_COLOR } from './constants';

export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(BG_COLOR, 1);

  // High-performance soft PCF shadow maps
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Output encoding & filmic tone mapping
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  container.appendChild(renderer.domElement);

  // Handle resize
  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return renderer;
}
