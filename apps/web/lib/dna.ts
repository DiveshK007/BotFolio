/**
 * Bot DNA: deterministic bot art from a seed. Same seed → same bot; version ≥ 2 adds an evolution badge.
 * Name/persona keywords pin a few signature traits (Gold Guru wears gold, AlphaWolf has ears).
 * Plain string building so it also runs in route handlers and next/og. Output is our own markup only:
 * user text never goes into the SVG (names are not rendered inside it).
 */
export type DnaMood = "smile" | "sad" | "o" | "think" | "dizzy" | "sleep" | "proud";
export interface DnaInput { seed: string; hint?: string; version?: number; mood?: DnaMood; uid?: string }
export interface DnaTraits { pal: [string, string]; body: string; eyes: string; ant: string; acc: string; pat: string; version: number }

let uid = 0;
export const dnaHash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const fnv = dnaHash;
const rng = (seed: number) => (): number => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const PAL: [string, string][] = [
  ['#2B50FF', '#1A36C9'], ['#FFC93C', '#D9A300'], ['#FF6FA8', '#D9467F'], ['#3DD6A3', '#1A9E76'],
  ['#FF7A3D', '#D4521A'], ['#8E6CCB', '#6847A8'], ['#19B6C9', '#0E8597'], ['#A7ADBA', '#737A88']
];
const BODIES = ['square', 'round', 'capsule', 'tv', 'egg'];
const EYES = ['round', 'round', 'visor', 'cyclops', 'sleepy', 'round'];
const ANT = ['ball', 'bolt', 'sprout', 'coil', 'twin', 'none'];
const ACC = ['none', 'none', 'headphones', 'glasses', 'bow', 'cap', 'scarf'];
const PAT = ['none', 'blush', 'stripes', 'spots', 'blush'];

export function dnaTraits(seed: string, hint = '', version = 1): DnaTraits {
  const r = rng(fnv(String(seed)));
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const t: DnaTraits = { pal: pick(PAL), body: pick(BODIES), eyes: pick(EYES), ant: pick(ANT), acc: pick(ACC), pat: pick(PAT), version };
  const h = hint.toLowerCase();
  if (/gold|granny/.test(h)) { t.pal = PAL[1]; t.acc = /granny/.test(h) ? 'glasses' : 'chain'; }
  if (/wolf/.test(h)) { t.pal = ['#6B7385', '#4A5163']; t.acc = 'ears'; t.eyes = 'round'; }
  if (/moon|rocket|yolo|maxi|momentum/.test(h)) { t.pal = PAL[4]; t.ant = 'bolt'; }
  if (/dip|doctor/.test(h)) { t.pal = PAL[3]; t.acc = 'band'; }
  if (/steady|sam/.test(h)) { t.pal = PAL[7]; t.body = 'tv'; t.acc = 'none'; }
  if (/botfolio|mascot/.test(h)) { t.pal = PAL[0]; t.body = 'square'; t.eyes = 'round'; t.ant = 'ball'; t.acc = 'none'; t.pat = 'blush'; }
  return t;
}

const BODY: Record<string, string> = {
  square: '<rect x="16" y="30" width="88" height="78" rx="26"/>',
  round: '<ellipse cx="60" cy="70" rx="45" ry="40"/>',
  capsule: '<rect x="26" y="24" width="68" height="86" rx="34"/>',
  tv: '<rect x="10" y="36" width="100" height="66" rx="18"/><rect x="30" y="100" width="10" height="10" rx="3"/><rect x="80" y="100" width="10" height="10" rx="3"/>',
  egg: '<path d="M60 26c26 0 42 30 42 52s-18 32-42 32-42-10-42-32 16-52 42-52z"/>'
};
const TOP: Record<string, number> = { square: 30, round: 30, capsule: 24, tv: 36, egg: 26 };

function eyes(kind: string, mood: string): string {
  if (mood === 'dizzy') return `<g data-part="eyes"><text x="40" y="74" font-size="22" text-anchor="middle" font-family="monospace" font-weight="700" fill="#14161C">@</text><text x="80" y="74" font-size="22" text-anchor="middle" font-family="monospace" font-weight="700" fill="#14161C">@</text></g>`;
  if (mood === 'sleep') return `<g data-part="eyes" stroke="#14161C" stroke-width="4" stroke-linecap="round" fill="none"><path d="M32 66q8 6 16 0"/><path d="M72 66q8 6 16 0"/></g>`;
  const lid = kind === 'sleepy' ? `<rect x="27" y="52" width="26" height="12" fill="currentColor" class="lid"/><rect x="67" y="52" width="26" height="12" fill="currentColor" class="lid"/>` : '';
  if (kind === 'visor') return `<g data-part="eyes" class="blinker"><rect x="26" y="54" width="68" height="24" rx="12" fill="#14161C"/><circle cx="44" cy="66" r="6" fill="#7CF7FF" data-eye="1"/><circle cx="76" cy="66" r="6" fill="#7CF7FF" data-eye="1"/></g>`;
  if (kind === 'cyclops') return `<g data-part="eyes" class="blinker"><circle cx="60" cy="64" r="17" fill="#fff"/><circle cx="60" cy="64" r="8" fill="#14161C" data-eye="1"/><circle cx="63" cy="60" r="2.5" fill="#fff" data-eye="1"/></g>`;
  return `<g data-part="eyes" class="blinker"><circle cx="40" cy="64" r="12" fill="#fff"/><circle cx="80" cy="64" r="12" fill="#fff"/><circle cx="40" cy="64" r="6" fill="#14161C" data-eye="1"/><circle cx="80" cy="64" r="6" fill="#14161C" data-eye="1"/><circle cx="42" cy="61" r="2" fill="#fff" data-eye="1"/><circle cx="82" cy="61" r="2" fill="#fff" data-eye="1"/>${lid}</g>`;
}
function mouth(mood: string): string {
  const m = ({ smile: 'M48 86q12 10 24 0', sad: 'M48 92q12 -9 24 0', o: 'M56 88a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', think: 'M50 89h20', dizzy: 'M48 90q6 -5 12 0t12 0', sleep: 'M54 88q6 4 12 0', proud: 'M46 84q14 14 28 0z' } as Record<string, string>)[mood] || 'M48 86q12 10 24 0';
  return `<path data-part="mouth" d="${m}" fill="${mood === 'proud' ? '#14161C' : 'none'}" stroke="#14161C" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function antenna(kind: string, top: number, c: string, evo: boolean): string {
  const glow = evo ? `<circle cx="60" cy="${top - 18}" r="11" fill="#FFC93C" opacity=".35"/>` : '';
  const s = ({ ball: `<line x1="60" y1="${top}" x2="60" y2="${top - 14}" stroke="${c}" stroke-width="5" stroke-linecap="round"/><circle cx="60" cy="${top - 18}" r="6" fill="${evo ? '#FFC93C' : c}"/>`,
    bolt: `<path d="M64 ${top - 22}l-10 13h8l-6 11 14-15h-8l6-9z" fill="#FFC93C" stroke="#14161C" stroke-width="2" stroke-linejoin="round"/>`,
    sprout: `<path d="M60 ${top}v-12" stroke="#1A9E76" stroke-width="4" stroke-linecap="round"/><path d="M60 ${top - 10}c-10 0-14-8-14-12 8 0 14 4 14 12zM60 ${top - 12}c8 0 12-6 12-10-7 0-12 3-12 10z" fill="#3DD6A3"/>`,
    coil: `<path d="M60 ${top}c-6-3 6-5 0-8s6-5 0-8 6-5 0-8" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/><circle cx="60" cy="${top - 26}" r="4.5" fill="${c}"/>`,
    twin: `<path d="M48 ${top + 2}l-8-14M72 ${top + 2}l8-14" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/><circle cx="39" cy="${top - 13}" r="5" fill="${c}"/><circle cx="81" cy="${top - 13}" r="5" fill="${c}"/>`,
    none: '' } as Record<string, string>)[kind];
  return `<g data-part="antenna">${glow}${s}</g>`;
}
function accessory(kind: string, top: number, c2: string): string {
  const a = ({
    chain: `<path d="M34 100q26 16 52 0" fill="none" stroke="#FFD95A" stroke-width="5" stroke-dasharray="5 3" stroke-linecap="round"/><circle cx="60" cy="110" r="6" fill="#FFD95A" stroke="#B88A00" stroke-width="2"/>`,
    ears: `<path d="M24 ${top + 14}l6-26 18 18z" fill="#4A5163" stroke="#14161C" stroke-width="2.5" stroke-linejoin="round"/><path d="M96 ${top + 14}l-6-26-18 18z" fill="#4A5163" stroke="#14161C" stroke-width="2.5" stroke-linejoin="round"/>`,
    headphones: `<path d="M18 66a42 42 0 0 1 84 0" fill="none" stroke="#14161C" stroke-width="5"/><rect x="8" y="58" width="14" height="24" rx="6" fill="#14161C"/><rect x="98" y="58" width="14" height="24" rx="6" fill="#14161C"/>`,
    glasses: `<g fill="none" stroke="#14161C" stroke-width="3.5"><circle cx="40" cy="64" r="15"/><circle cx="80" cy="64" r="15"/><path d="M55 64h10"/></g>`,
    bow: `<path d="M60 ${top + 2}l-16-9v18zM60 ${top + 2}l16-9v18z" fill="#FF6FA8" stroke="#14161C" stroke-width="2.5" stroke-linejoin="round"/><circle cx="60" cy="${top + 2}" r="4" fill="#14161C"/>`,
    cap: `<path d="M30 ${top + 12}q30-26 60 0z" fill="${c2}" stroke="#14161C" stroke-width="2.5"/><path d="M84 ${top + 10}h22" stroke="#14161C" stroke-width="5" stroke-linecap="round"/>`,
    scarf: `<path d="M26 98q34 12 68 0v8q-34 12-68 0z" fill="#FF6FA8" stroke="#14161C" stroke-width="2"/><path d="M80 104l6 16 8-4-6-14" fill="#FF6FA8" stroke="#14161C" stroke-width="2"/>`,
    band: `<rect x="22" y="${top + 6}" width="76" height="9" rx="4" fill="#fff" stroke="#14161C" stroke-width="2"/><path d="M60 ${top + 4}v13M54 ${top + 10}h12" stroke="#E04A4A" stroke-width="3"/>`,
    none: ''
  } as Record<string, string>)[kind];
  return `<g data-part="acc">${a}</g>`;
}
function pattern(kind: string): string {
  return ({ blush: '<g data-part="pat" fill="#FF6FA8" opacity=".55"><ellipse cx="28" cy="82" rx="7" ry="4"/><ellipse cx="92" cy="82" rx="7" ry="4"/></g>',
    stripes: '<g data-part="pat" stroke="rgba(255,255,255,.28)" stroke-width="5"><path d="M10 104l20-20M30 112l24-24M70 112l24-24M92 108l18-18"/></g>',
    spots: '<g data-part="pat" fill="rgba(255,255,255,.3)"><circle cx="26" cy="90" r="5"/><circle cx="96" cy="48" r="4"/><circle cx="90" cy="96" r="6"/></g>',
    none: '' } as Record<string, string>)[kind];
}
/** Deterministic bot SVG. Pass `uid` (React useId) so server and client markup match. */
export function dnaSvg({ seed = 'botfolio', hint = '', version = 1, mood = 'smile', uid: fixedUid }: DnaInput): string {
  const t = dnaTraits(seed, hint, version), [c, c2] = t.pal, top = TOP[t.body], evo = version >= 2;
  const clip = 'dna' + (fnv(seed + hint) % 1e7) + '_' + (fixedUid ?? ++uid);
  return `<svg viewBox="0 0 120 124" aria-hidden="true" focusable="false" style="color:${c}">
    <defs><clipPath id="${clip}">${BODY[t.body]}</clipPath></defs>
    ${antenna(t.ant, top, c2, evo)}
    ${t.acc === 'ears' ? accessory('ears', top, c2) : ''}
    <g data-part="body"><g fill="${c}" stroke="#14161C" stroke-width="3">${BODY[t.body]}</g>
      <g clip-path="url(#${clip})"><rect x="0" y="${top + 50}" width="120" height="80" fill="${c2}" opacity=".45"/>${pattern(t.pat)}</g>
      <path d="M30 ${top + 12}q8-6 18-6" stroke="rgba(255,255,255,.55)" stroke-width="5" stroke-linecap="round" fill="none"/></g>
    ${eyes(t.eyes, mood)}${mouth(mood)}
    ${t.acc !== 'ears' ? accessory(t.acc, top, c2) : ''}
    ${evo ? `<g data-part="evo"><circle cx="100" cy="${top + 4}" r="11" fill="#FFC93C" stroke="#14161C" stroke-width="2.5"/><text x="100" y="${top + 9}" text-anchor="middle" font-size="12" font-weight="800" font-family="Archivo,Arial" fill="#14161C">v${version}</text></g>` : ''}
  </svg>`;
}

/** Seed for a real bot: its id (stable for life); the version adds visible evolution. */
export const botSeed = (id: string | number) => `bot-${id}`;
/** Seed for an unborn preview from the sentence the visitor typed. */
export const sentenceSeed = (s: string) => `pet-${dnaHash(s.trim().toLowerCase())}`;
