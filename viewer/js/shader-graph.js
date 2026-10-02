// The game's material system in three.js: a costume material names a graphics material (its `shader`,
// e.g. Avatar_Metal) = a shader template (a graph of operations, from Materials.bin) + the values its
// operations take (tools/matunpack.py). build_web.py exports them to data/catalog/shaders.json.
//
// Each template is compiled once to GLSL: every operation is one block below, written from the game's own
// HLSL for it (shaders/D3D/ops/*.phl), on vec4 values like the game's assembler. Inputs an edge doesn't
// feed become uniforms (material value, else the template's fixed value, else the operation's default),
// so materials sharing a template share the program. The graph's Output feeds the game's lighting model
// (shaders/D3D/LightingModels/Standard.LightingModel + ops/Output.phl), mapped onto three's Phong lights:
//   albedo  = LitColor;  reflection_weight = ReflectionWeight (1 - ReflectionAddPercent),
//             add = ReflectionWeight ReflectionAddPercent,  refl = env(reflect(view, N)) x ReflectionColorMask
//   albedo  = lerp(albedo, albedo refl, reflection_weight)
//   colour  = albedo (diffuse + ambient) + SpecularValue SpecularColor x pow(dot(L, R), 128 SpecularExponent)
//             + lerp(Unlit, Unlit refl, reflection_weight) + add refl
// Colours are computed in the game's (gamma) space and converted to linear for three's lighting.
// Not the game's: the reflection cube (the game's comes from the map's sky), screen refraction (drawn as
// additive over the background), and the runtime values of oscillators / scrolling (1 + A sin / rate x time).
import * as THREE from 'three';

export const graphTime = { value: 0 };  // seconds, advanced by tickShaders()
export function tickShaders(now) { graphTime.value = (now / 1000) % 3600; }

// A simple sky / ground cube for reflections
let envCube = null;
function environment() {
  if (envCube) return envCube;
  const faces = [];
  for (let f = 0; f < 6; f++) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const fill = (stops) => { const gr = g.createLinearGradient(0, 0, 0, 64); stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); };
    if (f === 2) fill([[0, '#c8d4e6'], [1, '#c8d4e6']]);          // +Y sky
    else if (f === 3) fill([[0, '#2a2622'], [1, '#2a2622']]);     // -Y ground
    else fill([[0, '#c8d4e6'], [0.45, '#8c9099'], [0.55, '#4a4640'], [1, '#2a2622']]);
    faces.push(c);
  }
  envCube = new THREE.CubeTexture(faces);
  envCube.colorSpace = THREE.NoColorSpace;
  envCube.needsUpdate = true;
  return envCube;
}

const V = (x) => `vec4(${[0, 1, 2, 3].map(i => (+(x[i] ?? x[x.length - 1] ?? 0)).toFixed(6)).join(', ')})`;

// GLSL for each operation type: (i: input -> vec4 expression, o: output -> variable, u: extra) -> code
const OPS = {
  add: (i, o) => `${o.result} = ${i.a} + ${i.b};`,
  subtract: (i, o) => `${o.result} = ${i.a} - ${i.b};`,
  subtract_ignorealpha: (i, o) => `${o.result} = vec4(${i.a}.xyz - ${i.b}.xyz, 1.0);`,
  multiply: (i, o) => `${o.result} = ${i.a} * ${i.b};`,
  multiplyadd: (i, o) => `${o.result} = ${i.input} * ${i.scale} + ${i.offset};`,
  clamp: (i, o) => `${o.result} = clamp(${i.a}, 0.0, 1.0);`,
  invert: (i, o) => `${o.result} = 1.0 - ${i.a};`,
  slider: (i, o) => `${o.result} = ${i.a};`,
  colorvalue: (i, o) => `${o.result} = ${i.color};`,
  color0: (i, o) => `${o.color0} = ${i.defaultinput};`,
  texcoord0: (i, o) => `${o.texcoord0} = ${i.defaultinput};`,
  characterbacklightcolor: (i, o) => `${o.result} = ${i.backlightcolor};`,
  lerp: (i, o) => `${o.result} = mix(${i.b}, ${i.a}, ${i.weight});`,
  lerp_ignorealpha: (i, o) => `${o.result} = vec4(mix(${i.b}, ${i.a}, ${i.weight}).xyz, 1.0);`,
  lerp4: (i, o) => `{ vec4 w = ${i.weight}; ${o.result} = w.x * ${i.a} + w.y * ${i.b} + w.z * ${i.c} + w.w * ${i.d}; }`,
  normalize: (i, o) => `{ vec4 n = ${i.normal}; ${o.result} = vec4(normalize(n.xyz), n.w); }`,
  maskcombine: (i, o) => `{ vec4 t = ${i.tintcolormap}; float w0 = clamp(1.0 - dot(t.xyz, vec3(1.0)), 0.0, 1.0);
    ${o.result} = vec4(clamp(dot(vec4(t.xyz, w0), ${i.weight}), 0.0, 1.0)); }`,
  colortint4b: (i, o) => `{ vec4 t = ${i.tintcolormap}, d = ${i.diffuse}; float w0 = clamp(1.0 - dot(t.xyz, vec3(1.0)), 0.0, 1.0);
    vec4 r = w0 * ${i.color0} + t.x * ${i.color1} + t.y * ${i.color2} + t.z * ${i.color3};
    r = mix(vec4(1.0), r, ${i.tintmask}); ${o.result} = vec4((d * r).xyz, d.w); }`,
  colortint4b_ignorealpha: (i, o) => `{ vec4 t = ${i.tintcolormap}, d = ${i.diffuse}; float w0 = clamp(1.0 - dot(t.xyz, vec3(1.0)), 0.0, 1.0);
    vec3 r = w0 * ${i.color0}.xyz + t.x * ${i.color1}.xyz + t.y * ${i.color2}.xyz + t.z * ${i.color3}.xyz;
    r = mix(vec3(1.0), r, ${i.tintmask}.xyz); ${o.result} = vec4(d.xyz * r, 1.0); }`,
  lightbleedtransform: (i, o) => `{ float l = ${i.lightbleed}.x; float y = 1.0 / (1.0 + l); ${o.result} = vec4(y * l, y, y, y); }`,
  fresnelterm_advanced: (i, o) => `{ float d = dot(coTS(${i.normal}.xyz), coView); ${o.result} = vec4(pow(clamp(1.0 - abs(d), 0.0, 1.0), ${i.tightness}.x)); }`,
  specular: (i, o) => `${o.speccolor} = ${i.specularcolor}; ${o.specexponent} = vec4(${i.specularexponent}.x);`,
  specular_withvalue: (i, o) => `${o.speccolor} = ${i.specularcolor}; ${o.specexponent} = vec4(${i.specularexponent}.x); ${o.specvalue} = vec4(${i.specularvalue}.x);`,
  normaladd: (i, o) => `{ vec3 tn = ${i.tangentnormal}.xyz; vec4 dn = ${i.detailnormal};
    vec3 b = vec3(0.0, 1.0, 0.0), t = cross(b, tn); b = cross(tn, t);
    ${o.result} = vec4(normalize(t * dn.x + b * dn.y + tn * dn.z), dn.w); }`,
  // the materials store OscillatorValue 1 (its idle value); amplitude 0 (most of them) keeps it there
  oscillator: (i, o) => `${o.result} = vec4(1.0 + ${i.amplitude}.x * sin(6.2831853 * ${i.frequency}.x * coTime + ${i.phase}.x));`,
  timegradient: (i, o) => `${o.result} = vec4(${i.maximum}.x);`,
  overlay: (i, o) => `{ vec4 a = ${i.a}, b = ${i.b}; vec4 comp = vec4(lessThan(b, vec4(0.49999)));
    ${o.result} = vec4(mix(1.0 - 2.0 * (1.0 - b) * (1.0 - a), 2.0 * b * a, comp).xyz, 1.0); }`,
  refract: (i, o) => `${o.result} = vec4(0.0, 0.0, 0.0, 1.0);`,  // the screen behind: drawn additively instead
  scroll: (i, o) => `${o.result} = vec4(${i.scrollrate}.xy * coTime + ${i.texcoord}.xy, 0.0, 1.0);`,
  texscrollscale: (i, o) => `${o.result} = vec4(${i.texcoord}.xy * ${i.scale}.xy + ${i.scrollrate}.xy * coTime, 0.0, 0.0);`,
  texxfrm: (i, o) => `${o.result} = vec4(${i.texcoord}.xy * ${i.transform}.xy + ${i.transform}.zw, 0.0, 0.0);`,
  texrotate: (i, o) => `{ float a = ${i.rotation}.x + ${i.rotationrate}.x * coTime; vec2 s = ${i.scale}.xy, tc = ${i.texcoord}.xy;
    ${o.result} = vec4(dot(tc, vec2(cos(a), -sin(a)) * s.x), dot(tc, vec2(sin(a), cos(a)) * s.y), 0.0, 0.0); }`,
  floor: (i, o) => `{ vec2 f = vec2(${i.floorx}.x, ${i.floory}.x); ${o.result} = vec4(floor(${i.value}.xy / f) * f, 0.0, 0.0); }`,
  sphericalcoordsvs: (i, o) => `{ vec3 n = coTS(${i.normal}.xyz); vec2 tc = n.xy * vec2(0.5, -0.5) + vec2(0.5, -0.5); ${o.result} = tc.xyyy; }`,
  texture: (i, o, x) => `${o.result} = texture2D(${x.tex}, ${i.texcoord}.xy);`,
  'texture_2+': (i, o, x) => `${o.result} = texture2D(${x.tex}, ${i.texcoord}.xy); ${o.result2} = texture2D(${x.tex}, ${i.texcoord2}.xy);`,
  texturenormal: (i, o, x) => `{ vec4 t = texture2D(${x.tex}, ${i.texcoord}.xy); ${o.result} = vec4(t.xyz * 2.0 - 1.0, t.w); }`,
  texturenormaldxt5nm: (i, o, x) => `{ vec4 t = texture2D(${x.tex}, ${i.texcoord}.xy);
    vec2 xy = t.wy * 2.0 - 1.0; vec4 nm = vec4(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))), ${i.alphaifdxt5nm}.x);
    ${o.result} = mix(vec4(t.xyz * 2.0 - 1.0, t.w), nm, ${i.isdxt5nm}.x); }`,
};
const TEXTURE_INPUT = { texture: 'texture', 'texture_2+': 'texture', texturenormal: 'normalmap', texturenormaldxt5nm: 'normalmap' };

// Output inputs and their defaults (shaders/Operations/Output.op)
const OUTPUT_DEFAULTS = {
  litcolor: [0, 0, 0, 1], alpha: [1, 1, 1, 1], normal: [0, 0, 1, 0], specularcolor: [1, 1, 1, 1], specularvalue: [0, 0, 0, 0],
  specularexponent: [0.0625, 0, 0, 0], unlitcolor: [0, 0, 0, 0], alpharef: [0.6, 0, 0, 0], reflectionweight: [0, 0, 0, 0],
  reflectioncolormask: [1, 1, 1, 1], reflectionaddpercent: [0, 0, 0, 0],
};

const compiled = new Map();  // template name -> program description

// Compile a template: GLSL for the graph, plus the uniforms it needs (name -> {op, input, init}) and its
// texture slots (uniform name -> {op, input}).
export function compileTemplate(shaders, name) {
  if (compiled.has(name)) return compiled.get(name);
  const t = shaders.templates[name], defs = shaders.ops;
  const byName = new Map(t.ops.map((op, k) => [op.name, { ...op, k }]));
  const out = t.ops.find(op => op.type === 'output');
  const uniforms = {}, textures = {}, lines = [], done = new Set(), declared = [];
  const varOf = (op, output) => `g${op.k}_${output.replace(/[^a-z0-9]/g, '')}`;
  // takes the costume colours itself (a Color0 input, or the Color1..3 ColorValues the costume code sets)?
  let usesColors = t.ops.some(op => /^color[123]$/.test(op.name));
  const visit = (op) => {
    if (done.has(op.name)) return; done.add(op.name);
    const def = defs[op.type] || { inputs: {}, outputs: {} };
    const inputs = {};
    const names = new Set([...Object.keys(def.inputs), ...Object.keys(op.in), ...Object.keys(op.fixed)]);
    for (const input of names) {
      const edge = op.in[input];
      if (edge && byName.has(edge[0])) {
        const src = byName.get(edge[0]); visit(src);
        inputs[input] = varOf(src, edge[1]) + (edge[2] !== 'xyzw' ? '.' + edge[2] : '');
        continue;
      }
      const d = def.inputs[input]?.default;
      if (d?.type === 'TexCoord0') { inputs[input] = 'vec4(vNormalMapUv, 0.0, 0.0)'; continue; }
      if (d?.type === 'Color0') { inputs[input] = 'coColor0'; usesColors = true; continue; }
      if (TEXTURE_INPUT[op.type] === input) continue;
      const u = `u${op.k}_${input.replace(/[^a-z0-9]/g, '')}`;
      uniforms[u] = { op: op.name, input, init: op.fixed[input] || d?.floats || [0] };
      inputs[input] = u;
    }
    const outs = {};
    for (const o of Object.keys(def.outputs).length ? Object.keys(def.outputs) : ['result']) { outs[o] = varOf(op, o); declared.push(outs[o]); }
    const x = {};
    if (TEXTURE_INPUT[op.type]) { x.tex = `t${op.k}`; textures[x.tex] = { op: op.name, input: TEXTURE_INPUT[op.type] }; }
    const gen = OPS[op.type];
    const proxy = new Proxy(inputs, { get: (o, k) => o[k] ?? 'vec4(0.0)' });
    lines.push(gen ? gen(proxy, new Proxy(outs, { get: (o, k) => o[k] ?? 'coDiscard' }), x) : `// unsupported ${op.type}`);
    if (!gen) console.warn('shader op not supported:', op.type, 'in', name);
  };
  const outIn = {};
  for (const [k, init] of Object.entries(OUTPUT_DEFAULTS)) {
    const edge = out.in[k];
    if (edge && byName.has(edge[0])) {
      const src = byName.get(edge[0]); visit(src);
      outIn[k] = varOf(src, edge[1]) + (edge[2] !== 'xyzw' ? '.' + edge[2] : '');
    } else outIn[k] = V(out.fixed[k] || init);
  }
  const hasRefract = t.ops.some(op => op.type === 'refract');
  const prog = {
    name, uniforms, textures, flags: t.flags, reflection: t.reflection, hasRefract, usesColors,
    alphaConnected: !!out.in.alpha,
    glsl: `vec4 coDiscard; vec4 ${[...new Set(declared)].join(', ')};\n${lines.join('\n')}\n` +
      Object.entries(outIn).map(([k, e]) => `vec4 co_${k} = ${e};`).join('\n'),
    uniformDecl: [...Object.keys(uniforms).map(u => `uniform vec4 ${u};`), ...Object.keys(textures).map(s => `uniform sampler2D ${s};`)].join('\n'),
  };
  compiled.set(name, prog);
  return prog;
}

// A material for one costume shader. The returned material's userData.graph = { prog, uniforms } where
// uniforms[name] is the three.js uniform object (set values with setGraphValue / setGraphTexture).
export function createGraphMaterial(shaders, shaderName) {
  const def = shaders.materials[shaderName];
  if (!def) return null;
  const prog = compileTemplate(shaders, def.template);
  const gfx = def.gfxFlags || 0;
  const mat = new THREE.MeshPhongMaterial({ side: gfx & 4 ? THREE.DoubleSide : THREE.FrontSide });
  const additive = gfx & 1 || prog.hasRefract;
  const blended = additive || prog.flags & 32 || (prog.flags & 2 && prog.alphaConnected);
  if (blended) {
    mat.transparent = true;
    if (additive) {  // add light, leave the canvas alpha alone (the page's backdrop shows through the canvas)
      Object.assign(mat, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
                           blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
                           blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    }
  }
  // blended or not, only NoZWrite materials leave the depth buffer alone; the rest write it, so nearer
  // pieces of an ice or glass body hide farther ones whatever order the parts are drawn in
  mat.depthWrite = !(gfx & 8);
  mat.normalMap = FLAT_NORMAL;  // turns on three's tangent frame (tbn); the graph supplies the normal
  const u = {
    coTime: graphTime, coColor0: { value: new THREE.Vector4(1, 1, 1, 1) }, coTint: { value: new THREE.Vector4(1, 1, 1, 1) },
    coEnv: { value: environment() },
    coRawMask: { value: false }, coNormals: { value: true },
  };
  for (const [name, spec] of Object.entries(prog.uniforms)) {
    const v = def.values[spec.op]?.[spec.input];
    const init = Array.isArray(v) ? v : spec.init;
    u[name] = { value: new THREE.Vector4(...[0, 1, 2, 3].map(k => +(init[k] ?? init[init.length - 1] ?? 0))) };
  }
  for (const name of Object.keys(prog.textures)) u[name] = { value: WHITE };
  mat.userData.graph = { prog, def, uniforms: u, blended, additive };
  mat.customProgramCacheKey = () => 'cograph:' + prog.name + (mat.userData.graph.noNormals ? ':nn' : '') + (additive ? ':add' : '');
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    const noNormals = mat.userData.graph.noNormals;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float coTime; uniform vec4 coColor0, coTint; uniform samplerCube coEnv; uniform bool coRawMask;
        ${prog.uniformDecl}
        vec3 coSRGBToLinear( vec3 c ) { c = max(c, 0.0); return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) ); }
        vec3 coLit; float coAlpha; vec3 coSpecColor; float coSpecExp;`)
      .replace('#include <map_fragment>', '')
      .replace('#include <normal_fragment_maps>', `
        vec3 coView = normalize( vViewPosition );
        ${noNormals ? '' : '#define CO_USE_TBN'}
        #define coTS(n) ${noNormals ? 'normal' : 'normalize( tbn * (n) )'}
        ${prog.glsl}
        ${noNormals ? '' : 'normal = coTS( co_normal.xyz );'}
        float coReflW = co_reflectionweight.x * ( 1.0 - clamp( co_reflectionaddpercent.x, 0.0, 1.0 ) );
        float coReflAdd = co_reflectionweight.x * clamp( co_reflectionaddpercent.x, 0.0, 1.0 );
        vec3 coRefl = vec3( 0.0 );
        ${prog.reflection ? `coRefl = textureCube( coEnv, ( vec4( reflect( -coView, normal ), 0.0 ) * viewMatrix ).xyz ).rgb * co_reflectioncolormask.xyz;` : 'coReflW = 0.0; coReflAdd = 0.0;'}
        vec3 coAlbedo = mix( co_litcolor.xyz, co_litcolor.xyz * coRefl, coReflW );
        vec3 coUnlit = mix( co_unlitcolor.xyz, co_unlitcolor.xyz * coRefl, coReflW ) + coReflAdd * coRefl;
        coAlpha = clamp( co_alpha.w, 0.0, 1.0 );
        ${prog.flags & 2 || mat.transparent ? '' : 'if ( coAlpha < co_alpharef.x ) discard; coAlpha = 1.0;'}
        // the draw's tint colour (Output.phl: unlit and albedo times v.color0, alpha times its alpha)
        coAlbedo *= coTint.rgb; coUnlit *= coTint.rgb; coAlpha *= coTint.a;
        diffuseColor = vec4( coSRGBToLinear( coAlbedo ), coAlpha );
        totalEmissiveRadiance += coSRGBToLinear( coUnlit );
        coSpecColor = co_specularvalue.x * co_specularcolor.xyz;
        coSpecExp = clamp( co_specularexponent.x * 128.0, 0.25, 128.0 );`)
      .replace('#include <lights_phong_fragment>', `BlinnPhongMaterial material;
        material.diffuseColor = diffuseColor.rgb; material.specularColor = coSpecColor;
        material.specularShininess = coSpecExp; material.specularStrength = 1.0;`)
      .replace('#include <lights_phong_pars_fragment>', PHONG_PARS);
  };
  return mat;
}

// three's Blinn-Phong with the game's specular term: pow(dot(L, reflect(-V, N)), exponent), unnormalised,
// scaled by 1/pi like three's Lambert diffuse so the two keep the game's ratio.
const PHONG_PARS = /* glsl */`
varying vec3 vViewPosition;
struct BlinnPhongMaterial { vec3 diffuseColor; vec3 specularColor; float specularShininess; float specularStrength; };
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
  float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );
  vec3 r = reflect( -geometryViewDir, geometryNormal );
  float s = pow( saturate( dot( directLight.direction, r ) ), material.specularShininess ) * step( 0.0001, dotNL );
  reflectedLight.directSpecular += directLight.color * s * material.specularColor * RECIPROCAL_PI;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_BlinnPhong
#define RE_IndirectDiffuse RE_IndirectDiffuse_BlinnPhong
`;

function pixel(r, g, b, a) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true; return t;
}
const WHITE = pixel(255, 255, 255, 255);
const FLAT_NORMAL = pixel(128, 128, 255, 255);
const BLACK_MASK = pixel(0, 0, 0, 255);
export const GRAPH_DEFAULTS = { white: WHITE, flatNormal: FLAT_NORMAL, blackMask: BLACK_MASK };

// set a constant by operation name (e.g. 'color1', 'reflectionweight') if the template has it
export function setGraphValue(mat, op, input, v4) {
  const g = mat.userData.graph;
  for (const [name, spec] of Object.entries(g.prog.uniforms)) if (spec.op === op && spec.input === input) g.uniforms[name].value.set(...v4);
}
// the placeholder texture name each texture slot uses in this material (lower case)
export function graphTextureSlots(mat) {
  const g = mat.userData.graph;
  return Object.entries(g.prog.textures).map(([slot, spec]) => ({ slot, op: spec.op, placeholder: (g.def.values[spec.op]?.[spec.input] || '').toLowerCase() }));
}
// texture slots of a costume shader before any material exists: [{slot, placeholder}]
export function shaderTextureSlots(shaders, shaderName) {
  const def = shaders.materials[shaderName];
  if (!def) return [];
  const prog = compileTemplate(shaders, def.template);
  return Object.entries(prog.textures).map(([slot, spec]) => ({ slot, placeholder: (def.values[spec.op]?.[spec.input] || '').toLowerCase() }));
}
export function setGraphTexture(mat, slot, tex, fallback = WHITE) { mat.userData.graph.uniforms[slot].value = tex || fallback; }
