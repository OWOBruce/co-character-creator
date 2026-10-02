// Height ruler (View > Height ruler): a measuring stick on the floor beside the character, in feet (the
// scene's unit), with a tick every 6 inches and a label every foot, and a marker at the character's height
// as the Height slider has it (the game's number: hair and hats don't count). The compare figure gets its
// own grey marker. Drawn over everything, so the character never hides it.
import * as THREE from 'three';

const TOP = 8;  // feet: taller than the tallest character (the slider stops at 7')
export const feetInches = ft => { const inches = Math.round(ft * 12); return `${Math.floor(inches / 12)}' ${inches % 12}"`; };

// a text label as a sprite, h feet tall
function label(text, color, h) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), px = 64;
  g.font = `${px}px Bangers, Impact, sans-serif`;
  c.width = Math.ceil(g.measureText(text).width + px * 0.5); c.height = Math.ceil(px * 1.3);
  g.font = `${px}px Bangers, Impact, sans-serif`; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = px * 0.16; g.strokeStyle = '#000'; g.strokeText(text, px * 0.25, c.height / 2);
  g.fillStyle = color; g.fillText(text, px * 0.25, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(h * c.width / c.height, h, 1); s.renderOrder = 11;
  s.userData.text = text;
  return s;
}
const lines = (pts, color, opacity = 1) => {
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity }));
  l.renderOrder = 10;
  return l;
};

export class HeightRuler {
  constructor(scene, x = 2.2) {
    this.group = new THREE.Group(); this.group.visible = false; this.x = x;
    const pts = [new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, TOP, 0)];
    for (let i = 1; i <= TOP * 2; i++) {  // every 6 inches; longer at each foot
      const y = i / 2, w = i % 2 ? 0.12 : 0.25;
      pts.push(new THREE.Vector3(x - w, y, 0), new THREE.Vector3(x, y, 0));
    }
    this.group.add(lines(pts, 0xd8e6ff, 0.85));
    for (let ft = 1; ft <= TOP; ft++) {
      const l = label(`${ft}'`, '#d8e6ff', 0.32);
      l.center.set(0, 0.5); l.position.set(x + 0.08, ft, 0);
      this.group.add(l);
    }
    this.markers = new Map();  // name -> { line, tag, y }
    scene.add(this.group);
  }
  get visible() { return this.group.visible; }
  set visible(v) { this.group.visible = v; }
  // a marker at height y (feet) spanning x0..x1, labelled at its left end; null y removes it
  mark(name, y, x0, x1, color) {
    const m = this.markers.get(name);
    if (m && m.y === y && m.x0 === x0 && m.x1 === x1) return;
    if (m) {  // replaced or removed: free its GPU copies
      this.group.remove(m.line, m.tag);
      m.line.geometry.dispose(); m.line.material.dispose(); m.tag.material.map.dispose(); m.tag.material.dispose();
      this.markers.delete(name);
    }
    if (y == null) return;
    const text = feetInches(y);
    const line = lines([new THREE.Vector3(x0, y, 0), new THREE.Vector3(x1, y, 0)], color);
    const tag = label(text, color === 0xffd21f ? '#ffd21f' : '#c9c9c9', 0.36);
    tag.center.set(1, 0); tag.position.set(x1, y + 0.03, 0);
    this.group.add(line, tag);
    this.markers.set(name, { line, tag, y, x0, x1 });
  }
}
