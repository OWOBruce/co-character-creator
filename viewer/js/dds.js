// DDS -> three.js texture. DXT1/DXT5 stay compressed on the GPU (with the file's mip chain);
// uncompressed BGR(A) / 1555 files are expanded to RGBA. Texture data is raw (NoColorSpace):
// the costume shader does its own colour maths, like the game. Compressed cube maps (the game's
// reflection maps) give their six faces, each with its mip chain, in the file's order (+X -X +Y -Y +Z -Z).
import * as THREE from 'three';

const FOURCC = { DXT1: THREE.RGBA_S3TC_DXT1_Format, DXT3: THREE.RGBA_S3TC_DXT3_Format, DXT5: THREE.RGBA_S3TC_DXT5_Format };

function shiftOf(mask) { let s = 0; while (mask && !(mask & 1)) { mask >>>= 1; s++; } return [s, mask]; }

export function parseDDS(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x20534444) throw new Error('not a DDS file');
  const height = dv.getUint32(12, true), width = dv.getUint32(16, true);
  const mipCount = Math.max(1, dv.getUint32(28, true));
  const pfFlags = dv.getUint32(80, true);
  const cube = (dv.getUint32(112, true) & 0x200) !== 0;  // DDSCAPS2_CUBEMAP
  let off = 128;
  if (pfFlags & 4) {
    const four = String.fromCharCode(...new Uint8Array(buffer, 84, 4));
    const format = FOURCC[four];
    if (format === undefined) throw new Error('unsupported DDS ' + four);
    const blockBytes = four === 'DXT1' ? 8 : 16;
    const chain = () => {
      const mipmaps = [];
      let w = width, h = height;
      for (let i = 0; i < mipCount; i++) {
        const size = Math.max(4, w) / 4 * Math.max(4, h) / 4 * blockBytes;
        if (off + size > buffer.byteLength) break;
        mipmaps.push({ data: new Uint8Array(buffer, off, size), width: w, height: h });
        off += size; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      }
      return mipmaps;
    };
    if (cube) return { compressed: true, cube: true, format, faces: Array.from({ length: 6 }, chain), width, height };
    return { compressed: true, format, mipmaps: chain(), width, height };
  }
  // uncompressed: top level only, mips are regenerated
  const bits = dv.getUint32(88, true);
  const masks = [92, 96, 100, 104].map(o => dv.getUint32(o, true));
  const alpha = (pfFlags & 1) && masks[3];
  const bpp = bits / 8, n = width * height, out = new Uint8Array(n * 4);
  const sh = masks.map(shiftOf);
  for (let i = 0, p = off; i < n; i++, p += bpp) {
    const v = bpp === 4 ? dv.getUint32(p, true) : bpp === 3 ? dv.getUint16(p, true) | dv.getUint8(p + 2) << 16 : dv.getUint16(p, true);
    for (let c = 0; c < 4; c++) {
      const [s, m] = sh[c];
      out[i * 4 + c] = c === 3 && !alpha ? 255 : m ? Math.round(((v >>> s) & m) * 255 / m) : 0;
    }
  }
  return { compressed: false, data: out, width, height };
}

// a compressed DDS cube map -> a cube texture (sampled with the game's own direction vectors: D3D and
// WebGL lay cube faces out the same way, so the faces go up as stored)
export function ddsCubeTexture(buffer) {
  const d = parseDDS(buffer);
  if (!d.cube) throw new Error('not a DDS cube map');
  const tex = new THREE.CompressedCubeTexture(d.faces.map(mipmaps => ({ mipmaps, width: d.width, height: d.height })), d.format);
  tex.minFilter = d.faces[0].length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function ddsTexture(buffer) {
  const d = parseDDS(buffer);
  let tex;
  if (d.compressed) {
    tex = new THREE.CompressedTexture(d.mipmaps, d.width, d.height, d.format);
    tex.minFilter = d.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  } else {
    tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat);
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
