/**
 * PlantUML text encoding (deflate + custom base64) — dependency-free.
 * Also builds @startjson diagram text from a JSON-LD document.
 */

import zlib from 'node:zlib';

const PLANTUML_BASE = 'https://www.plantuml.com/plantuml';

/**
 * @param {unknown} ldJson
 * @returns {string} PlantUML diagram source
 */
export function jsonDiagramText(ldJson) {
  return `@startjson\n${JSON.stringify(ldJson ?? {}, null, 2)}\n@endjson`;
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
