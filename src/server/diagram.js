/**
 * PlantUML text encoding (deflate + custom base64) — dependency-free.
 * Also builds @startjson diagram text from a JSON-LD document.
 */

import zlib from 'node:zlib';

const PLANTUML_BASE = 'https://www.plantuml.com/plantuml';

const IA_NS = 'https://twinseed.local/ia#';
const DIAGRAM_HIGHLIGHT_TYPES = new Set([
  'DiagramHighlight',
  `${IA_NS}DiagramHighlight`,
  'ia:DiagramHighlight',
]);
const DIAGRAM_FOCUS_SET_TYPES = new Set([
  'DiagramFocusSet',
  `${IA_NS}DiagramFocusSet`,
  'ia:DiagramFocusSet',
]);

const ROLE_LOCAL_NAMES = new Set(['Focus', 'Warning', 'StatusOk', 'StatusBad']);

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
 * Role stereotype classes (.Focus etc.) style #highlight … <<Role>> cells.
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
  .Focus {
    BackGroundColor #2e5a4a
    FontColor #f5f0e4
  }
  .Warning {
    BackGroundColor #b3541e
    FontColor #f5f0e4
  }
  .StatusOk {
    BackGroundColor #3d6b4f
    FontColor #f5f0e4
  }
  .StatusBad {
    BackGroundColor #8b3a2a
    FontColor #f5f0e4
  }
}
</style>`;

/**
 * @param {unknown} type
 * @param {Set<string>} allowed
 * @returns {boolean}
 */
function typeIncludes(type, allowed) {
  if (typeof type === 'string') return allowed.has(type);
  if (Array.isArray(type)) return type.some((t) => typeIncludes(t, allowed));
  return false;
}

/**
 * @param {unknown} node
 * @returns {boolean}
 */
export function isDiagramHighlight(node) {
  return (
    !!node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    typeIncludes(/** @type {Record<string, unknown>} */ (node)['@type'], DIAGRAM_HIGHLIGHT_TYPES)
  );
}

/**
 * @param {unknown} node
 * @returns {boolean}
 */
export function isDiagramFocusSet(node) {
  return (
    !!node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    typeIncludes(/** @type {Record<string, unknown>} */ (node)['@type'], DIAGRAM_FOCUS_SET_TYPES)
  );
}

/**
 * Normalize role to a PlantUML stereotype local name (Focus, Warning, …).
 * @param {unknown} role
 * @returns {string|undefined}
 */
export function roleStereotype(role) {
  if (role == null) return undefined;
  if (typeof role === 'string') {
    const trimmed = role.trim();
    if (!trimmed) return undefined;
    if (ROLE_LOCAL_NAMES.has(trimmed)) return trimmed;
    const hash = trimmed.lastIndexOf('#');
    if (hash >= 0) {
      const local = trimmed.slice(hash + 1);
      if (ROLE_LOCAL_NAMES.has(local)) return local;
    }
    const colon = trimmed.lastIndexOf(':');
    if (colon >= 0) {
      const local = trimmed.slice(colon + 1);
      if (ROLE_LOCAL_NAMES.has(local)) return local;
    }
    // Allow custom short tokens that are safe stereotype names
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) return trimmed;
    return undefined;
  }
  if (typeof role === 'object' && !Array.isArray(role)) {
    const id = /** @type {Record<string, unknown>} */ (role)['@id'];
    if (typeof id === 'string') return roleStereotype(id);
  }
  return undefined;
}

/**
 * Parse highlightPath into segments. Allows exact keys/indices and `"*"` wildcards.
 * @param {unknown} pathValue
 * @returns {string[]|null}
 */
export function normalizeHighlightPath(pathValue) {
  if (pathValue == null) return null;
  /** @type {unknown[]} */
  let segments;
  if (Array.isArray(pathValue)) {
    segments = pathValue;
  } else if (typeof pathValue === 'object' && Array.isArray(/** @type {any} */ (pathValue)['@list'])) {
    segments = /** @type {any} */ (pathValue)['@list'];
  } else if (typeof pathValue === 'string') {
    segments = pathValue.split('/').map((s) => s.trim()).filter(Boolean);
  } else {
    return null;
  }
  const out = [];
  for (const seg of segments) {
    if (seg == null) continue;
    out.push(String(seg));
  }
  return out.length ? out : null;
}

/**
 * Fan-out a path that may contain `"*"` against a JSON value.
 * `*` matches every own key of an object, or every array index (as a string).
 * PlantUML also accepts `"*"` natively in `#highlight`; Twinseed expands so
 * emission is concrete `#highlight` lines (stable across PlantUML versions and
 * easy to assert in tests). No matches → empty list.
 *
 * @param {string[]} segments
 * @param {unknown} root
 * @returns {string[][]}
 */
export function expandWildcardPath(segments, root) {
  if (!segments.length) return [];

  /**
   * @param {string[]} segs
   * @param {unknown} node
   * @param {string[]} prefix
   * @returns {string[][]}
   */
  function walk(segs, node, prefix) {
    if (segs.length === 0) return [prefix];
    if (node == null || typeof node !== 'object') return [];

    const [head, ...rest] = segs;
    /** @type {string[][]} */
    const found = [];

    if (head === '*') {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          found.push(...walk(rest, node[i], [...prefix, String(i)]));
        }
      } else {
        for (const [k, v] of Object.entries(node)) {
          found.push(...walk(rest, v, [...prefix, k]));
        }
      }
      return found;
    }

    if (Array.isArray(node)) {
      const idx = Number(head);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length || String(idx) !== head) {
        return [];
      }
      return walk(rest, node[idx], [...prefix, head]);
    }

    if (!Object.prototype.hasOwnProperty.call(node, head)) return [];
    return walk(rest, /** @type {Record<string, unknown>} */ (node)[head], [...prefix, head]);
  }

  return walk(segments, root, []);
}

/**
 * @param {string[]} segments
 * @param {string|undefined} role
 * @returns {string}
 */
export function formatHighlightDirective(segments, role) {
  const path = segments.map((s) => `"${String(s).replace(/"/g, '')}"`).join(' / ');
  const stereo = role ? ` <<${role}>>` : '';
  return `#highlight ${path}${stereo}`;
}

/**
 * @typedef {{ segments: string[], role?: string }} HighlightSpec
 */

/**
 * @param {unknown} node
 * @returns {HighlightSpec|null}
 */
function highlightSpecFromNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const obj = /** @type {Record<string, unknown>} */ (node);
  // Inside a focus set, allow highlight-shaped objects without an explicit @type.
  if (obj['@type'] != null && !isDiagramHighlight(obj)) return null;
  if (obj['@type'] == null && obj.highlightPath == null) return null;
  const segments = normalizeHighlightPath(obj.highlightPath);
  if (!segments) return null;
  return { segments, role: roleStereotype(obj.role) };
}

/**
 * @param {unknown} value
 * @param {HighlightSpec[]} into
 */
function collectFromFocusValue(value, into) {
  if (value == null) return;
  if (isDiagramFocusSet(value)) {
    const set = /** @type {Record<string, unknown>} */ (value);
    const list = set.highlights ?? set.diagramFocus;
    collectFromFocusValue(list, into);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFromFocusValue(item, into);
    return;
  }
  if (isDiagramHighlight(value) || (typeof value === 'object' && value && 'highlightPath' in value)) {
    const spec = highlightSpecFromNode(value);
    if (spec) into.push(spec);
  }
}

/**
 * Collect DiagramHighlight / DiagramFocusSet / diagramFocus annotations,
 * strip them from the JSON body, expand `"*"` path segments against the body,
 * and return PlantUML `#highlight` lines.
 * @param {unknown} ldJson
 * @returns {{ body: unknown, lines: string[], specs: HighlightSpec[] }}
 */
export function extractDiagramHighlights(ldJson) {
  /** @type {HighlightSpec[]} */
  const specs = [];

  /**
   * @param {unknown} value
   * @returns {unknown}
   */
  function walk(value) {
    if (Array.isArray(value)) {
      /** @type {unknown[]} */
      const out = [];
      for (const item of value) {
        if (isDiagramHighlight(item) || isDiagramFocusSet(item)) {
          collectFromFocusValue(item, specs);
          continue;
        }
        out.push(walk(item));
      }
      return out;
    }
    if (value && typeof value === 'object') {
      if (isDiagramHighlight(value) || isDiagramFocusSet(value)) {
        collectFromFocusValue(value, specs);
        return undefined;
      }
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === 'diagramFocus') {
          collectFromFocusValue(v, specs);
          continue;
        }
        if (k === '@graph' && Array.isArray(v)) {
          out[k] = walk(v);
          continue;
        }
        const next = walk(v);
        if (next !== undefined) out[k] = next;
      }
      return out;
    }
    return value;
  }

  let body = walk(ldJson);
  if (body === undefined) body = {};

  /** @type {string[]} */
  const lines = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const spec of specs) {
    // Exact paths emit as-is (PlantUML may still style a missing cell).
    // Wildcard paths expand against the stripped body; no matches → no lines.
    const paths = spec.segments.includes('*')
      ? expandWildcardPath(spec.segments, body)
      : [spec.segments];
    for (const path of paths) {
      const line = formatHighlightDirective(path, spec.role);
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }

  return { body, lines, specs };
}

/**
 * @param {unknown} ldJson
 * @returns {string} PlantUML diagram source
 */
export function jsonDiagramText(ldJson) {
  const safe = sanitizeLdForDiagram(ldJson) ?? {};
  const { body, lines } = extractDiagramHighlights(safe);
  const directives = lines.length ? `${lines.join('\n')}\n` : '';
  return `@startjson\n${TWINSEED_JSON_SKIN}\n${directives}${JSON.stringify(body, null, 2)}\n@endjson`;
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
