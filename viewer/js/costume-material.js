// The costume shader as a three.js material (see README "Colouring" and "Muscle").
//
// Colour (ColorTint4b):  tint = (1-R-G-B)*C0 + R*C1 + G*C2 + B*C3 from the pattern mask,
//                        colour = lerp(1, tint, mask.a) * Diffuse          (sRGB maths, like the game)
// Normal (NormalAdd):    muscleN = lerp(flat, Muscles, clamp(dot([r, g, b, 1-r-g-b], MuscleWeight)))
//                        n = Detail expressed in muscleN's frame (t = cross(Y, m), b = cross(m, t))
// Everything is uniforms, so changing colours, skin or muscle never rebuilds a texture.
import * as THREE from 'three';

function pixelTexture(r, g, b, a) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
export const DEFAULTS = {
  mask: pixelTexture(0, 0, 0, 255),       // all Colour0, fully tinted
  diffuse: pixelTexture(255, 255, 255, 255),
  normal: pixelTexture(128, 128, 255, 255),
};

const MAP_FRAGMENT = /* glsl */`
  vec4 coMask = coHasMask ? texture2D( map, vMapUv ) : vec4( 0.0, 0.0, 0.0, 1.0 );
  vec3 coCol;
  if ( coRawMask ) coCol = coMask.rgb;
  else {
    float coRest = max( 0.0, 1.0 - coMask.r - coMask.g - coMask.b );
    vec3 coTint = coRest * coColor[0] + coMask.r * coColor[1] + coMask.g * coColor[2] + coMask.b * coColor[3];
    coCol = mix( vec3( 1.0 ), coTint, coMask.a );
  }
  coCol *= texture2D( coDiffuse, vMapUv ).rgb;
  diffuseColor.rgb *= coSRGBToLinear( coCol );
`;

const NORMAL_FRAGMENT = /* glsl */`
  vec3 coD = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  vec3 mapN = coD;
  if ( coHasMuscle ) {
    vec4 coK = coHasMask ? texture2D( map, vNormalMapUv ) : vec4( 0.0 );
    float k = clamp( dot( vec4( coK.rgb, max( 0.0, 1.0 - coK.r - coK.g - coK.b ) ), coMuscleWeight ), 0.0, 1.0 );
    vec3 coM = texture2D( coMuscle, vNormalMapUv ).xyz * 2.0 - 1.0;
    vec3 m = normalize( vec3( coM.xy * k, 1.0 + ( coM.z - 1.0 ) * k ) );
    vec3 t = normalize( vec3( m.z, 0.0, -m.x ) );
    vec3 b = cross( m, t );
    mapN = normalize( t * coD.x + b * coD.y + m * coD.z );
  }
`;

export function createCostumeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide });
  const u = {
    coColor: { value: [0, 1, 2, 3].map(() => new THREE.Color(1, 1, 1)) },
    coHasMask: { value: false },
    coRawMask: { value: false },
    coDiffuse: { value: DEFAULTS.diffuse },
    coMuscle: { value: DEFAULTS.normal },
    coHasMuscle: { value: false },
    coMuscleWeight: { value: new THREE.Vector4() },
  };
  mat.map = DEFAULTS.mask;            // the pattern mask (also defines vMapUv)
  mat.normalMap = DEFAULTS.normal;    // the detail normal map (also defines the tangent frame)
  mat.userData.uniforms = u;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 coColor[4]; uniform bool coHasMask, coRawMask, coHasMuscle;
        uniform sampler2D coDiffuse, coMuscle; uniform vec4 coMuscleWeight;
        vec3 coSRGBToLinear( vec3 c ) { return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) ); }`)
      .replace('#include <map_fragment>', MAP_FRAGMENT);
    const line = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';
    const chunk = THREE.ShaderChunk.normal_fragment_maps;
    if (!chunk.includes(line)) throw new Error('three.js normal chunk changed');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', chunk.replace(line, NORMAL_FRAGMENT));
  };
  return mat;
}

// textures: { mask, diffuse, detail, muscle } (THREE textures or null)
export function setCostumeTextures(mat, { mask, diffuse, detail, muscle }) {
  const u = mat.userData.uniforms;
  mat.map = mask || DEFAULTS.mask; u.coHasMask.value = !!mask;
  u.coDiffuse.value = diffuse || DEFAULTS.diffuse;
  mat.normalMap = detail || DEFAULTS.normal;
  u.coMuscle.value = muscle || DEFAULTS.normal;
  u.coHasMuscle.value = !!muscle;
  mat.needsUpdate = true;
}

// Colour constants as the engine builds them (GameClient 0xcd1110..0xcd1350 and 0xcd1d10):
//   ColorN = Color_N / 255; if glowScale[N] > 1 the colour's HSV value is multiplied by glowScale[N]
//   (an overbright colour: that is all glow is); on skin materials (HasSkin, costume ColorSkin set)
//   Color3 is the skin colour, without glow. AllowGlow only limits what the creator offers.
export const SKIN_SLOT = 3;
export function costumeColorValues(colors, skin, hasSkin, glow) {
  return colors.map((col, i) => {
    const isSkin = i === SKIN_SLOT && hasSkin && skin?.some(v => v);
    const src = isSkin ? skin : col;
    const k = !isSkin && glow?.[i] > 1 ? glow[i] : 1;
    return [src[0] / 255 * k, src[1] / 255 * k, src[2] / 255 * k];
  });
}
export function setCostumeColors(mat, colors, skin, hasSkin, glow) {
  const c = mat.userData.uniforms.coColor.value;
  costumeColorValues(colors, skin, hasSkin, glow).forEach((v, i) => c[i].setRGB(...v, THREE.NoColorSpace));
}

// MuscleWeight[i] = muscle / 100, zeroed where the material suppresses muscle for colour i
export function setCostumeMuscle(mat, muscle, suppress) {
  const w = [0, 1, 2, 3].map(i => (suppress?.[i] ? 0 : muscle / 100));
  mat.userData.uniforms.coMuscleWeight.value.set(...w);
}
