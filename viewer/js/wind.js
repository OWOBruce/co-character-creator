// The wind the cloth feels. In the game it comes from the world's wind grid (dynWind.c): each map's sky
// sets a Speed (0-10 in the editor), its variation, a direction with per-axis variation and a change
// rate, and wind sources add to it. The grid is sampled at the character (0x169b440), split into a unit
// direction and a speed, and handed to every cloth piece (0x15ff560 -> 0x169cc00).
// The creator's sky (Master_Exterior) isn't in the client data, so the viewer sets the wind itself:
// speed, the heading it blows toward, and gusts. The gust pattern (a few sine waves) is the viewer's own.
export class Wind {
  constructor() { this.speed = 0; this.heading = 0; this.gusts = 0.5; }
  // heading 0 blows from the character's front to its back (world -Z); 90 blows toward world +X
  sample(t) {
    if (this.speed <= 0) return { dir: [0, 0, -1], speed: 0 };
    const g = this.gusts;
    const speed = this.speed * Math.max(0, 1 + g * (0.45 * Math.sin(0.9 * t) + 0.3 * Math.sin(2.3 * t + 1) + 0.15 * Math.sin(5.1 * t + 2)));
    const a = (this.heading + g * 20 * (Math.sin(0.37 * t) + 0.5 * Math.sin(1.1 * t + 0.7))) * Math.PI / 180;
    return { dir: [Math.sin(a), 0, -Math.cos(a)], speed };
  }
}
