/**
 * src/car/GhostModel.ts
 * ─────────────────────────────────────────────────────────────
 * Holographic Ghost Car Visual.
 *
 * Translucent glowing cyan/purple mesh + glowing wireframe outline.
 * Replays best lap alongside the player.
 *
 * RULES.md: Zero per-frame allocations. Cached geometry & materials.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { CarConfig as C } from './CarConfig';

export class GhostModel {
  readonly group = new THREE.Group();

  constructor() {
    // ── Translucent Hologram Materials ───────────────────────
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x8800ff,
      transparent: true,
      opacity: 0.32,
      wireframe: false,
      depthWrite: false,
    });

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.65,
      wireframe: true,
      depthWrite: false,
    });

    // Body
    const bodyGeo = new THREE.BoxGeometry(C.carWidth, C.carHeight * 0.45, C.carLength);
    const bodyMesh = new THREE.Mesh(bodyGeo, ghostMat);
    const bodyWire = new THREE.Mesh(bodyGeo, wireMat);
    bodyMesh.position.y = C.carHeight * 0.25;
    bodyWire.position.y = C.carHeight * 0.25;
    bodyWire.scale.setScalar(1.02);
    this.group.add(bodyMesh, bodyWire);

    // Canopy
    const canopyGeo = new THREE.BoxGeometry(C.carWidth * 0.7, C.carHeight * 0.45, C.carLength * 0.5);
    const canopyMesh = new THREE.Mesh(canopyGeo, ghostMat);
    const canopyWire = new THREE.Mesh(canopyGeo, wireMat);
    canopyMesh.position.set(0, C.carHeight * 0.65, 0.1);
    canopyWire.position.set(0, C.carHeight * 0.65, 0.1);
    this.group.add(canopyMesh, canopyWire);

    // Start hidden until a best lap is set
    this.group.visible = false;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}
