// The colour dropper (the colour popup's pipette, colors.js): the costume colour a character has at the spot
// under the cursor, not the pixel's colour, so light, shine and glow don't change it.
// The one pixel under the cursor is drawn again with every costume material in pick mode (uniform coPick: the
// piece's number), where a spot writes its piece and the colour slot its mask gives it (coRegionSlot: the
// "Colour regions" rule, the slot most of it takes) instead of its colour. Same scene, same matrices, so
// skinning, cloth, the body sliders and the mirroring all match what's on screen; the nearest piece wins.
// The answer is that piece's colour in that slot, with its glow. Skin, spots the mask leaves untinted, and
// templates with no colour tint give nothing.
import * as THREE from 'three';
import { SKIN_SLOT } from './costume-material.js';

const target = new THREE.WebGLRenderTarget(1, 1), pixel = new Uint8Array(4);
const pickUniform = mat => mat?.userData?.graph?.uniforms.coPick || mat?.userData?.uniforms?.coPick || null;

// characters: the Character objects to pick from (the costume, the compare figure); clientX/Y: the cursor.
// -> { rgba: [r, g, b, a] (0-255), glow } or null
export function pickColour(renderer, scene, camera, characters, clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
  const pieces = [], drawn = new Set();
  for (const ch of characters) {
    if (!ch?.group?.visible) continue;
    for (const p of ch.parts.values()) {
      const mesh = p.mesh, u = pickUniform(mesh?.material);
      // pieces the editor hides (black Fx, unless "Show hidden psionics") aren't there to pick
      if (!mesh?.visible || !u || (mesh.material.userData.graph?.hidden && !ch.options.showHidden) || pieces.length === 255) continue;
      pieces.push(p); drawn.add(mesh);
    }
  }
  if (!pieces.length) return null;
  // everything else (grid, ruler, skeleton, the grey compare figure) is left out; lights stay, so no material
  // needs another program. Blending off and depth written, so the nearest piece's number comes back whole.
  const hidden = [], restore = [];
  scene.traverse(o => { if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && o.visible && !drawn.has(o)) { o.visible = false; hidden.push(o); } });
  pieces.forEach((p, i) => {
    const mat = p.mesh.material;
    restore.push([mat, mat.blending, mat.depthWrite]);
    pickUniform(mat).value = i + 1; mat.blending = THREE.NoBlending; mat.depthWrite = true;
  });
  const old = renderer.getRenderTarget(), clearAlpha = renderer.getClearAlpha(), clearColor = renderer.getClearColor(new THREE.Color());
  try {
    camera.setViewOffset(rect.width, rect.height, x, y, 1, 1);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
  } finally {
    camera.clearViewOffset();
    renderer.setRenderTarget(old); renderer.setClearColor(clearColor, clearAlpha);
    for (const o of hidden) o.visible = true;
    for (const [mat, blending, depthWrite] of restore) { pickUniform(mat).value = 0; mat.blending = blending; mat.depthWrite = depthWrite; }
  }
  const p = pieces[pixel[0] - 1], slot = pixel[1];
  if (!p || slot > 3 || (p.res.hasSkin && slot === SKIN_SLOT)) return null;
  const rgba = p.part.colors?.[slot];
  return rgba ? { rgba, glow: p.part.glow?.[slot] || 0 } : null;
}
