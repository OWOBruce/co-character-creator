// Compare figure (View > Compare with): the masculine or feminine default in plain grey, at the game's
// default body, or a character from a costume file or demo in its own costume. It stands to the
// character's left in the same stance (by its name in the creator: Heroic, Average...), for seeing how
// tall or broad the character is next to another. It is only drawn: never saved, never in the
// character sheet, and the costume panels don't touch it.
import * as THREE from 'three';
import { Character } from './character.js';

const GREY = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.85, metalness: 0 });

export class CompareFigure {
  // blank(skeleton) -> a new costume document (index.html's blank)
  constructor(scene, blank, x = -3.4) {
    this.ch = new Character(scene);
    this.blank = blank; this.x = x;
    this.shown = null;  // what's loaded: a skeleton's default, or a costume document
    this.on = false; this.loading = null; this.stanceName = null;
  }
  get loaded() { return !!this.ch.group && this.on; }

  // Show it or hide it (null): a skeleton name for its default, in grey, or a costume document as it is.
  // Resolves once it's drawn.
  async show(what, main) {
    this.on = !!what;
    if (!what) { if (this.ch.group) this.ch.group.visible = false; return; }
    if (this.shown !== what) {
      this.shown = what;
      const grey = typeof what === 'string';
      const load = this.loading = this.ch.load(grey ? await this.blank(what) : what);
      if (!await load || this.loading !== load) return;
      // a default in plain grey: its costume isn't the point, and grey reads as "not the character"
      if (grey) this.ch.group.traverse(o => { if (o.isMesh) { o.material = GREY; o.castShadow = false; } });
      this.ch.rig.helper.visible = false;
      this.stanceName = null;
    }
    this.ch.group.position.x = this.x;
    this.ch.group.visible = this.on;
    await this.follow(main);
  }

  // the main character's stance by its creator name (the skeletons name theirs differently), and its mirror
  async follow(main) {
    if (!this.on || !this.ch.group || !main.cat) return;
    this.ch.group.scale.x = main.options.mirror ? -1 : 1;
    const shown = main.cat.stances.find(s => s.name === main.doc.stance)?.displayName;
    const mine = this.ch.cat.stances.find(s => s.player && s.displayName === shown)
      || this.ch.cat.stances.find(s => s.player && s.displayName === 'Heroic');
    const mode = main.mode || 'idle';
    if (!mine || this.stanceName === mine.name + '|' + mode) return;
    this.stanceName = mine.name + '|' + mode;
    await this.ch.setStance(mine.name, mode);
  }

  // the body height the Height slider would show for it (the game's default)
  get height() { return this.ch.bodyValues?.height; }
  tick(now, play) { if (this.loaded) this.ch.tick(now, play); }
  afterMatrixUpdate(now) { if (this.loaded) this.ch.afterMatrixUpdate(now); }
  // objects to hide in pictures (character sheet, saved costume preview)
  hide() { return this.ch.group ? [this.ch.group] : []; }
}
