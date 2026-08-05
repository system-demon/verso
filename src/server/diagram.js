/**
 * PlantUML text encoding (deflate + custom base64) — dependency-free.
 * Also builds @startjson diagram text from a JSON-LD document.
 */

import zlib from 'node:zlib';

const PLANTUML_BASE = 'https://www.plantuml.com/plantuml';

/**
 * Soften root-relative Twinseed paths ("/exemplar/...") for PlantUML @startjson.
 * Absolute path-like strings can be treated as include/file paths by the renderer;
 * stripping the leading slash keeps them readable without that hazard.
 * @param {unknown} value
 * @returns {unknown}
 */
export function sanitizeLdForDiagram(value) {
  if (typeof value === 'string') {
    if (value.startsWith('/') && !value.startsWith('//')) return value.slice(1);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeLdForDiagram(v));
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeLdForDiagram(v);
    return out;
  }
  return value;
}

/**
 * Twinseed paper aesthetic for PlantUML @startjson (matches live/twinseed.css).
 * Applied in-source so the SVG itself harmonizes with cream sheets — no CSS filters.
 */
const TWINSEED_JSON_SKIN = `skinparam backgroundColor #f5f0e4
skinparam shadowing false
<style>
jsonDiagram {
  FontName Courier
  FontColor #221d15
  node {
    BackGroundColor #f5f0e4
    LineColor #d8cdb4
    FontName Courier
    FontColor #221d15
    FontSize 12
    RoundCorner 2
    LineThickness 1
    separator {
      LineThickness 0.5
      LineColor #d8cdb4
    }
  }
  arrow {
    LineColor #6b6151
    LineThickness 1
    BackGroundColor #ede5d2
  }
  highlight {
    BackGroundColor #2e5a4a
    FontColor #f5f0e4
  }
}
</style>`;

/**
 * @param {unknown} ldJson
 * @returns {string} PlantUML diagram source
 */
export function jsonDiagramText(ldJson) {
  const safe = sanitizeLdForDiagram(ldJson) ?? {};
  return `@startjson\n${TWINSEED_JSON_SKIN}\n${JSON.stringify(safe, null, 2)}\n@endjson`;
}

/**
 * PlantUML's custom 6-bit alphabet: 0-9 A-Z a-z - _
 * @param {number} b
 */
function encode6bit(b) {
  if (b < 10) return String.fromCharCode(48 + b);
  b -= 10;
  if (b < 26) return String.fromCharCode(65 + b);
  b -= 26;
  if (b < 26) return String.fromCharCode(97 + b);
  b -= 26;
  if (b === 0) return '-';
  if (b === 1) return '_';
  return '?';
}

function append3bytes(b1, b2, b3) {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return (
    encode6bit(c1 & 0x3f) +
    encode6bit(c2 & 0x3f) +
    encode6bit(c3 & 0x3f) +
    encode6bit(c4 & 0x3f)
  );
}

/**
 * Encode diagram text for the PlantUML server's URL path.
 * @param {string} text
 * @returns {string}
 */
export function encodePlantUml(text) {
  const data = zlib.deflateRawSync(Buffer.from(text, 'utf8'));
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 === data.length) out += append3bytes(data[i], data[i + 1], 0);
    else if (i + 1 === data.length) out += append3bytes(data[i], 0, 0);
    else out += append3bytes(data[i], data[i + 1], data[i + 2]);
  }
  return out;
}

/**
 * @param {string} text
 * @param {'svg'|'png'|'txt'} format
 */
export function plantUmlUrl(text, format = 'svg') {
  return `${PLANTUML_BASE}/${format}/${encodePlantUml(text)}`;
}

/**
 * PlantUML's JSON SVG still stamps a white root background even when skinparam
 * asks for paper/transparent. Rewrite that chrome so the SVG sits on the sheet.
 * @param {string} svg
 * @returns {string}
 */
export function harmonizePlantUmlSvg(svg) {
  return svg.replace(
    /background:\s*#(?:fff(?:fff)?|ffffff)\b/gi,
    'background:transparent',
  );
}
