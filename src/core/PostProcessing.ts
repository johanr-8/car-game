/**
 * src/core/PostProcessing.ts
 * ─────────────────────────────────────────────────────────────
 * One cheap bloom pass — per RULES.md, no additional passes.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM_THRESHOLD, BLOOM_STRENGTH, BLOOM_RADIUS } from './constants';

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene:    THREE.Scene,
  camera:   THREE.Camera,
): EffectComposer {
  const size = new THREE.Vector2();
  renderer.getSize(size);

  const composer    = new EffectComposer(renderer);
  const renderPass  = new RenderPass(scene, camera);
  const bloomPass   = new UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  const outputPass  = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  (composer as any).bloomPass = bloomPass;

  return composer;
}
