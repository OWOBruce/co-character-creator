// Saved costumes in the game's own format: screenshots/Costume_<account>_<name>_CC_Comic_Page_Blue_<time>.jpg
//
// A 300x400 JPEG (the character on the CC_Comic_Page_Blue comic cover) with a Photoshop APP13 block holding
// IPTC records, written by GameClient 0x802d20 / 0x8031e0 and read by 0x8050a0:
//   2:0   record version (00 02)
//   2:25  keywords "FightClub", "FC" (product name / short name) and "Gender:<Male|Female>"
//   2:120 captions: account name, character name, "7799" + checksum of the costume text + NUL
//   2:202 the costume as Cryptic parser text: { CostumeV5 <name> { Skeleton ... Part { ... } ... } }
// The loader recomputes the checksum (costume-hash.js) and rejects the file if it differs.
import { costumeHash } from './costume-hash.js';

const NL = '\r\n';
const LINKS = ['None', 'All', 'Mirror', 'Group', 'MirrorGroup', 'Different'];  // enum at GameClient 0x20171b8
// field order of the game's structs (recovered ParseTables): known fields are written in this order,
// anything else read from a file is kept and written back in place
const COSTUME_ORDER = ['Species', 'BodySockInfo', 'CostumeType', 'Gender', 'DefaultColorLinkAll', 'DefaultMaterialLinkAll',
  'Voice', 'BodyScale', 'ScaleValues', 'Muscle', 'Height', 'Stance', 'TexWords', 'ArtistData', 'ColorSkin',
  'RegionCategory', 'Part', 'PlayerCantChange', 'AccountUnlock', 'LoadedOnClient',
  'CostumeChangeAlwaysSaveSequencersIfSkelsMatch', 'Transition'];
const PART_ORDER = ['Bone', 'Geometry', 'Material', 'PatternTexture', 'DetailTexture', 'SpecularTexture', 'DiffuseTexture',
  'Movable', 'Color_0', 'Color_1', 'Color_2', 'Color_3', 'CustomColors', 'TextureValues', 'ArtistData', 'ColorLink',
  'MaterialLink', 'ControlledRandomLocks', 'BoneGroupIndex', 'Cloth', 'pchAnimNodeAliasList'];

// ---- Cryptic parser text ------------------------------------------------------------------------
// Entries: { name, value, block? }. One field per line; a struct is its name line followed by { ... }.
export function parseText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let i = 0;
  const block = () => {
    const out = [];
    while (i < lines.length) {
      const l = lines[i++];
      if (l === '}') return out;
      if (l === '{') { out.push({ name: '', value: '', block: block() }); continue; }
      // the value keeps its own spacing (lists are written "Name  a,  b"), so fields passed through unchanged
      // are written back exactly
      const m = l.match(/^(\S+)(?:\s(.*))?$/);
      const e = { name: m[1], value: m[2] ?? '' };
      if (lines[i] === '{') { i++; e.block = block(); }
      out.push(e);
    }
    return out;
  };
  return block();
}
function writeEntries(entries, depth) {
  const tabs = '\t'.repeat(depth);
  let s = '';
  for (const e of entries) {
    if (e.block) s += NL + tabs + e.name + (e.value ? ' ' + e.value : '') + NL + tabs + '{' + NL + writeEntries(e.block, depth + 1) + tabs + '}' + NL;
    else s += tabs + e.name + (e.value !== '' ? ' ' + e.value : '') + NL;
  }
  return s;
}

const unquote = v => { v = v.trim(); return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v; };
const quote = v => (/[\s"{},]/.test(v) || v === '' ? `"${v.replace(/"/g, '')}"` : v);
const nums = v => v.split(',').map(x => parseFloat(x)).filter(x => !Number.isNaN(x));
// the game's float text: "%f" from 1 up, the shortest 6-significant-digit form below (0.80645, 0)
const f6 = v => (Math.abs(v) >= 1 ? (+v).toFixed(6) : String(+(+v).toPrecision(6)));
// list values: the game writes "Name  a,  b,  c" (two spaces after the name, one of which the writer adds)
const color = c => ' ' + c.slice(0, 4).map(x => Math.round(x)).join(',  ');
const ints = a => ' ' + a.map(x => Math.round(x)).join(',  ');

// ---- costume text <-> editor document ------------------------------------------------------------
export function textToDoc(text) {
  const root = parseText(text);
  const top = root.find(e => /^Costume/i.test(e.name) && e.block) || root[0]?.block?.find(e => /^Costume/i.test(e.name) && e.block);
  if (!top) throw new Error('No costume found in the file');
  return entryToDoc(top);
}
// a costume struct: { value: its name, block: its fields }
function entryToDoc(top) {
  const doc = { name: unquote(top.value), skeleton: '', costumeType: 'Player', stance: '', skin: null, height: 0, muscle: 0,
                bodyScale: [], scaleValues: {}, regionCategories: {}, parts: [], extra: [] };
  for (const e of top.block) {
    switch (e.name) {
      case 'Skeleton': doc.skeleton = unquote(e.value); break;
      case 'CostumeType': doc.costumeType = e.value.trim(); break;
      case 'BodyScale': doc.bodyScale = nums(e.value); break;
      case 'ScaleValues': { const [n, v] = e.value.trim().split(/\s+/); doc.scaleValues[n] = parseFloat(v); break; }
      case 'Muscle': doc.muscle = parseFloat(e.value); break;
      case 'Height': doc.height = parseFloat(e.value); break;
      case 'Stance': doc.stance = unquote(e.value); break;
      case 'ColorSkin': doc.skin = nums(e.value); break;
      case 'RegionCategory': { const [r, c] = e.value.trim().split(/\s+/); doc.regionCategories[r] = c; break; }
      case 'Part': doc.parts.push(entriesToPart(e.block)); break;
      default: doc.extra.push(e);
    }
  }
  return doc;
}
function entriesToPart(entries) {
  const p = { bone: '', geometry: '', material: '', pattern: '', detail: '', diffuse: '', specular: '',
              colors: [0, 1, 2, 3].map(() => [0, 0, 0, 255]), glow: [0, 0, 0, 0], colorLink: 0, materialLink: 0, extra: [] };
  const key = { Bone: 'bone', Geometry: 'geometry', Material: 'material', PatternTexture: 'pattern', DetailTexture: 'detail',
                DiffuseTexture: 'diffuse', SpecularTexture: 'specular' };
  for (const e of entries) {
    if (key[e.name]) p[key[e.name]] = unquote(e.value);
    else if (/^Color_[0-3]$/.test(e.name)) p.colors[+e.name[6]] = nums(e.value);
    else if (e.name === 'ColorLink') p.colorLink = Math.max(0, LINKS.indexOf(e.value.trim()));
    else if (e.name === 'MaterialLink') p.materialLink = Math.max(0, LINKS.indexOf(e.value.trim()));
    else if (e.name === 'CustomColors' && e.block) {
      const g = e.block.find(x => x.name === 'glowScale');
      if (g) p.glow = nums(g.value);
      const rest = e.block.filter(x => x.name !== 'glowScale');
      if (rest.length) p.customExtra = rest;  // reflection / specularity settings, written back as read
    } else p.extra.push(e);
  }
  return p;
}

// resolve(part) -> { material, pattern, detail, diffuse, specular } as the game would store them
export function docToText(doc, { name, resolve, regionCategories } = {}) {
  const fields = [];
  fields.push({ name: 'CostumeType', value: doc.costumeType || 'Player' });
  if (doc.bodyScale?.length) fields.push({ name: 'BodyScale', value: ' ' + doc.bodyScale.map(f6).join(',  ') });
  for (const [n, v] of Object.entries(doc.scaleValues || {})) if (v) fields.push({ name: 'ScaleValues', value: `${n} ${f6(v)}` });
  if (doc.muscle) fields.push({ name: 'Muscle', value: f6(doc.muscle) });  // zero / default fields are left out
  if (doc.height) fields.push({ name: 'Height', value: f6(doc.height) });
  if (doc.stance) fields.push({ name: 'Stance', value: quote(doc.stance) });
  if (doc.skin) fields.push({ name: 'ColorSkin', value: color(doc.skin) });
  for (const [r, c] of Object.entries(regionCategories || doc.regionCategories || {})) if (c) fields.push({ name: 'RegionCategory', value: `${r} ${c}` });
  for (const p of doc.parts) fields.push({ name: 'Part', value: '', block: partToEntries(p, resolve) });
  const block = [{ name: 'Skeleton', value: quote(doc.skeleton) }, ...ordered(fields, doc.extra || [], COSTUME_ORDER)];
  return NL + '{' + NL + writeEntries([{ name: 'CostumeV5', value: quote(name ?? doc.name ?? ''), block }], 1) + '}' + NL;
}
function partToEntries(p, resolve) {
  const r = resolve ? resolve(p) : p;
  const f = [{ name: 'Bone', value: p.bone }, { name: 'Geometry', value: p.geometry }];
  if (r.material) f.push({ name: 'Material', value: r.material });
  for (const [k, n] of [['pattern', 'PatternTexture'], ['detail', 'DetailTexture'], ['specular', 'SpecularTexture'], ['diffuse', 'DiffuseTexture']])
    if (r[k]) f.push({ name: n, value: r[k] });
  p.colors.forEach((c, i) => f.push({ name: `Color_${i}`, value: color(c) }));
  if (p.glow?.some(v => v) || p.customExtra?.length) {
    const cc = p.glow?.some(v => v) ? [{ name: 'glowScale', value: ints(p.glow) }] : [];
    f.push({ name: 'CustomColors', value: '', block: [...cc, ...(p.customExtra || [])] });
  }
  if (p.colorLink) f.push({ name: 'ColorLink', value: LINKS[p.colorLink] });
  if (p.materialLink) f.push({ name: 'MaterialLink', value: LINKS[p.materialLink] });
  return ordered(f, p.extra || [], PART_ORDER);
}
// known fields plus kept ones, in the struct's field order (unknown names last)
function ordered(known, extra, order) {
  const all = [...known, ...extra], rank = n => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
  return all.map((e, i) => [e, i]).sort((a, b) => rank(a[0].name) - rank(b[0].name) || a[1] - b[1]).map(x => x[0]);
}

// ---- demo recordings (Live/demos/*.demo) -----------------------------------------------------------
// Parser text too: a header (ZoneName, activePlayerRef, ...) and packets. Each entity coming into view is
// in a packet's createdEnts: EntityRef, ContainerID, EntityAttach { savedName (character name),
// CostumeData { CostumeSlot { Costume <name> { ... } } ... } (the recording player only) }, entityTypeEnum,
// CostumeV5 { pStoredCostume <name> { ... } } (the costume worn). A player is usually created more than
// once; the last one is kept. Costumes don't change in later packets.
// -> { zone, players: [{ id, name, account, doc, active, slots: [doc], worn: index in slots or -1 }] }, recording player first
export function readDemo(text) {
  if (!/^\s*\{\s*Version /.test(text.slice(0, 200))) throw new Error('Not a Champions Online demo recording');
  const head = k => text.slice(0, 2000).match(new RegExp(`^${k} (.+?)\\r?$`, 'm'))?.[1] ?? '';
  const activeRef = head('activePlayerRef').trim();
  const byId = new Map();
  const toDoc = e => { try { return entryToDoc(e); } catch { return null; } };
  const same = (a, b) => JSON.stringify({ ...a, name: '', extra: [] }) === JSON.stringify({ ...b, name: '', extra: [] });
  const entity = b => {
    const f = n => b.find(x => x.name === n);
    if (f('entityTypeEnum')?.value.trim() !== 'ENTITYPLAYER') return;
    const attach = f('EntityAttach')?.block || [];
    const name = unquote(attach.find(x => x.name === 'savedName')?.value || '');
    const worn = f('CostumeV5')?.block?.find(x => x.block), doc = worn && toDoc(worn);
    if (!doc) return;
    const id = f('ContainerID')?.value.trim() || name;
    const slots = (attach.find(x => x.name === 'CostumeData')?.block || []).filter(x => x.name === 'CostumeSlot')
      .map(s => s.block?.find(x => x.block)).filter(Boolean).map(toDoc).filter(Boolean);
    // the costume's reference name is usually "<account>_<character>"
    const m = doc.name.match(/^(.+?)_(.+)$/), account = m && m[2].toLowerCase() === name.toLowerCase() ? m[1] : '';
    const prev = byId.get(id);
    byId.delete(id);  // re-insert: the list follows the last appearance
    byId.set(id, { id, name: name || doc.name, account, doc, active: f('EntityRef')?.value.trim() === activeRef,
                   slots: slots.length ? slots : prev?.slots || [] });
  };
  const walk = entries => {
    for (const e of entries) {
      if (!e.block) continue;
      if (e.name === 'createdEnts') entity(e.block); else walk(e.block);
    }
  };
  walk(parseText(text));
  const players = [...byId.values()].sort((a, b) => b.active - a.active);
  for (const p of players) p.worn = p.slots.findIndex(s => same(s, p.doc));
  return { zone: head('ZoneName').split('/').pop().replace(/\.Zone$/i, ''), players };
}

// ---- IPTC in a JPEG --------------------------------------------------------------------------------
const latin1 = s => Uint8Array.from(s, ch => ch.charCodeAt(0) & 0xff);
const unlatin1 = b => String.fromCharCode(...b);
// the game's "7799%10.10d": its printf pads to 10 characters including the minus sign
export function hashCaption(h) { return '7799' + (h < 0 ? '-' + String(-h).padStart(9, '0') : String(h).padStart(10, '0')); }

function* segments(bytes) {
  let p = 2;
  while (p + 4 <= bytes.length && bytes[p] === 0xff) {
    const marker = bytes[p + 1], len = bytes[p + 2] << 8 | bytes[p + 3];
    yield { marker, start: p, data: bytes.subarray(p + 4, p + 2 + len) };
    if (marker === 0xda) return;
    p += 2 + len;
  }
}
function iptcRecords(app13) {
  const out = [];
  let p = 14;  // "Photoshop 3.0\0"
  while (p + 12 <= app13.length && unlatin1(app13.subarray(p, p + 4)) === '8BIM') {
    const id = app13[p + 4] << 8 | app13[p + 5], nl = app13[p + 6];
    let q = p + 6 + 1 + nl; if ((1 + nl) % 2) q++;
    const size = (app13[q] << 24 | app13[q + 1] << 16 | app13[q + 2] << 8 | app13[q + 3]) >>> 0; q += 4;
    if (id === 0x0404) {
      let k = q;
      while (k + 5 <= q + size && app13[k] === 0x1c) {
        const n = app13[k + 3] << 8 | app13[k + 4];
        out.push({ record: app13[k + 1], dataset: app13[k + 2], data: app13.subarray(k + 5, k + 5 + n) });
        k += 5 + n;
      }
    }
    p = q + size + (size % 2);
  }
  return out;
}

// -> { text, doc, account, character, gender, storedHash, hash, hashOk }
export function readCostumeJpeg(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG file');
  const app13 = [...segments(bytes)].find(s => s.marker === 0xed && unlatin1(s.data.subarray(0, 13)) === 'Photoshop 3.0');
  if (!app13) throw new Error('This picture has no costume in it (no IPTC block)');
  const recs = iptcRecords(app13.data);
  const text = recs.find(r => r.dataset === 202);
  if (!text) throw new Error('This picture has no costume in it');
  const captions = recs.filter(r => r.dataset === 120).map(r => unlatin1(r.data).replace(/\0+$/, ''));
  const keywords = recs.filter(r => r.dataset === 25).map(r => unlatin1(r.data));
  const hashCap = captions.find(c => c.startsWith('7799'));
  const storedHash = hashCap ? parseInt(hashCap.slice(4), 10) : null;
  const hash = costumeHash(text.data);
  const str = unlatin1(text.data);
  return { text: str, doc: textToDoc(str), account: captions[0] ?? '', character: captions[1] ?? '',
           gender: keywords.find(k => k.startsWith('Gender:'))?.slice(7) || '', storedHash, hash,
           hashOk: storedHash === null || storedHash === hash };
}

// Add the costume's IPTC block to a JPEG (as the game does, right after the JFIF header).
export async function writeCostumeJpeg(jpegBlob, { account, character, gender, text }) {
  const bytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const textBytes = latin1(text);
  if (textBytes.length > 0x7fff) throw new Error('Costume text too long for an IPTC record');
  const recs = [
    [0, Uint8Array.of(0, 2)],
    [25, latin1('FightClub')], [25, latin1('FC')], [25, latin1('Gender:' + gender)],
    [120, latin1(account)], [120, latin1(character)], [120, latin1(hashCaption(costumeHash(textBytes)) + '\0')],
    [202, textBytes],
  ];
  const iptcLen = recs.reduce((n, [, d]) => n + 5 + d.length, 0);
  const irbLen = 14 + 4 + 2 + 2 + 4 + iptcLen + (iptcLen % 2);
  const seg = new Uint8Array(4 + irbLen);
  const dv = new DataView(seg.buffer);
  dv.setUint16(0, 0xffed); dv.setUint16(2, 2 + irbLen);
  let p = 4;
  seg.set(latin1('Photoshop 3.0\0'), p); p += 14;
  seg.set(latin1('8BIM'), p); p += 4;
  dv.setUint16(p, 0x0404); p += 2;
  p += 2;  // empty resource name, padded to even
  dv.setUint32(p, iptcLen); p += 4;
  for (const [ds, d] of recs) { seg[p] = 0x1c; seg[p + 1] = 2; seg[p + 2] = ds; dv.setUint16(p + 3, d.length); seg.set(d, p + 5); p += 5 + d.length; }
  // after the APP0 (JFIF) segment if there is one
  const app0 = [...segments(bytes)].find(s => s.marker === 0xe0);
  const at = app0 ? app0.start + 2 + (bytes[app0.start + 2] << 8 | bytes[app0.start + 3]) : 2;
  return new Blob([bytes.subarray(0, at), seg, bytes.subarray(at)], { type: 'image/jpeg' });
}

// The game's file name. Its number is Cryptic time: seconds since 2000-01-01 UTC.
export function costumeFileName(account, character) {
  const secs = Math.floor((Date.now() - Date.UTC(2000, 0, 1)) / 1000);
  const clean = s => s.replace(/[\\/:*?"<>|]/g, '');
  return `Costume_${clean(account)}_${clean(character)}_CC_Comic_Page_Blue_${secs}.jpg`;
}
