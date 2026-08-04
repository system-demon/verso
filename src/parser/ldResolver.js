/**
 * LD Resolver — reactive { ref } resolution + ld_if conditionals
 */

/**
 * @param {unknown} value
 * @param {import('./contentMap.js').ContentMap} contentMap
 * @returns {unknown}
 */
export function resolveRefs(value, contentMap) {
  if (Array.isArray(value)) {
    return value.map((v) => resolveRefs(v, contentMap));
  }

  if (value && typeof value === 'object') {
    if ('ref' in value && Object.keys(value).length === 1) {
      return contentMap.get(/** @type {{ ref: string }} */ (value).ref) ?? null;
    }

    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[normalizeLdKey(k)] = resolveRefs(v, contentMap);
    }
    return out;
  }

  return value;
}

/**
 * YAML keys like @type stay as @type; plain keys pass through.
 * @param {string} key
 */
export function normalizeLdKey(key) {
  return key;
}

/**
 * Evaluate an ld_if condition object.
 * Supports:
 *   { ref, operator, value }
 *   { ref, operator: "exists" }      — selector present in the ContentMap
 *   { ref }                          — truthiness (present and non-empty)
 *   or string form "price < 20" / "#id .stock exists" / "#id .stock"
 *
 * @param {object|string} condition
 * @param {import('./contentMap.js').ContentMap} contentMap
 * @returns {boolean}
 */
export function evaluateCondition(condition, contentMap) {
  if (typeof condition === 'string') {
    return evaluateStringCondition(condition, contentMap);
  }

  if (!condition || typeof condition !== 'object') return false;

  const resolved = resolveRefs(condition, contentMap);
  const ref =
    typeof condition.ref === 'string'
      ? contentMap.get(condition.ref)
      : resolved.ref;
  const operator = condition.operator;
  const target = condition.value;

  // No operator and no target value → truthiness of the resolved ref
  if (operator === undefined && target === undefined) {
    return isTruthy(ref);
  }

  return compare(ref, operator ?? '==', target);
}

/**
 * @param {unknown} v
 */
function isTruthy(v) {
  return v !== undefined && v !== null && v !== '' && v !== false;
}

/**
 * @param {string} expr
 * @param {import('./contentMap.js').ContentMap} contentMap
 */
function evaluateStringCondition(expr, contentMap) {
  const trimmed = expr.trim();
  const m = trimmed.match(/^(.+?)\s*(<=|>=|==|!=|<|>|contains|exists)\s*(.*)$/);
  if (!m) {
    // Bare selector/string → truthiness of the ContentMap lookup
    return isTruthy(contentMap.get(trimmed));
  }
  const [, leftRaw, op, rightRaw] = m;
  if (op === 'exists') {
    return compare(contentMap.get(leftRaw.trim()), 'exists', undefined);
  }
  const left = contentMap.get(leftRaw.trim()) ?? leftRaw.trim();
  const right = unquote(rightRaw.trim());
  return compare(left, op, right);
}

/**
 * @param {unknown} actual
 * @param {string} operator
 * @param {unknown} target
 */
function compare(actual, operator, target) {
  const aNum = parseFloat(String(actual));
  const tNum = parseFloat(String(target));
  const bothNumeric = !Number.isNaN(aNum) && !Number.isNaN(tNum);

  switch (operator) {
    case '<':
      return bothNumeric ? aNum < tNum : String(actual) < String(target);
    case '>':
      return bothNumeric ? aNum > tNum : String(actual) > String(target);
    case '<=':
      return bothNumeric ? aNum <= tNum : String(actual) <= String(target);
    case '>=':
      return bothNumeric ? aNum >= tNum : String(actual) >= String(target);
    case '==':
      return bothNumeric ? aNum === tNum : String(actual) === String(target);
    case '!=':
      return bothNumeric ? aNum !== tNum : String(actual) !== String(target);
    case 'contains':
      return String(actual).includes(String(target));
    case 'exists':
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

function unquote(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Blocks/conditionals are collected as { block, graphId } wrappers so the
 * emitting element's graph node id travels with the block. Tolerates legacy
 * raw-block entries (no wrapper) for external callers.
 * @param {unknown} entry
 * @returns {{ block: any, graphId?: string }}
 */
function unwrapEntry(entry) {
  if (
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    'block' in entry
  ) {
    const wrapped = /** @type {{ block: any, graphId?: string }} */ (entry);
    return { block: wrapped.block, graphId: wrapped.graphId };
  }
  return { block: entry, graphId: undefined };
}

/**
 * @param {unknown} v
 */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Dedupe array items (objects compared structurally).
 * @param {unknown[]} arr
 * @returns {unknown[]}
 */
function dedupeArray(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = isPlainObject(item) ? JSON.stringify(item) : item;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Union two @type values (same type stays scalar; differing types become an array).
 * @param {unknown} a
 * @param {unknown} b
 */
function unionTypes(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const types = dedupeArray([...[].concat(a), ...[].concat(b)]);
  return types.length === 1 ? types[0] : types;
}

/**
 * Deep-merge source entity into target entity (same @id). Plain objects merge
 * recursively, arrays concatenate (deduped), scalars: source wins.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 */
function mergeInto(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (k === '@id') continue;
    if (k === '@type') {
      target['@type'] = unionTypes(target['@type'], v);
      continue;
    }
    const t = target[k];
    if (isPlainObject(t) && isPlainObject(v)) {
      mergeInto(/** @type {Record<string, unknown>} */ (t), /** @type {Record<string, unknown>} */ (v));
    } else if (Array.isArray(t) && Array.isArray(v)) {
      target[k] = dedupeArray([...t, ...v]);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/**
 * Group entities by @id; entities sharing an @id merge into one graph node.
 * Order of first appearance is preserved.
 * @param {object[]} entities
 * @returns {object[]}
 */
function mergeById(entities) {
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();
  /** @type {object[]} */
  const out = [];
  for (const e of entities) {
    const id = isPlainObject(e) ? /** @type {Record<string, unknown>} */ (e)['@id'] : undefined;
    if (typeof id === 'string' && id) {
      const existing = byId.get(id);
      if (existing) {
        mergeInto(existing, /** @type {Record<string, unknown>} */ (e));
      } else {
        const copy = { .../** @type {Record<string, unknown>} */ (e) };
        byId.set(id, copy);
        out.push(copy);
      }
    } else {
      out.push(e);
    }
  }
  return out;
}

/**
 * Combine a base @context with additional contexts (from ld blocks).
 * Each may be a string, array, or map; result stays scalar when singular.
 * @param {unknown} base
 * @param {unknown[]} extras
 * @returns {unknown}
 */
function mergeContexts(base, extras) {
  /** @type {unknown[]} */
  const items = [];
  const push = (c) => {
    if (Array.isArray(c)) c.forEach(push);
    else if (c !== undefined && c !== null) items.push(c);
  };
  push(base);
  for (const e of extras) push(e);
  const deduped = dedupeArray(items);
  return deduped.length === 1 ? deduped[0] : deduped;
}

/**
 * Process collected ld / ld_if blocks into a final JSON-LD graph.
 * - Entity-level @context is hoisted to the document root and merged with the
 *   root @context (string | array | map forms are all preserved).
 * - Entities sharing an @id merge into a single graph node, so ld:, ld_if and
 *   convention-harvested entities can all contribute to the same subject.
 * @param {{ root: Record<string, unknown>, blocks: Array<{ block: object, graphId?: string } | object>, conditionals: Array<{ block: object, graphId?: string } | object> }} collected
 * @param {import('./contentMap.js').ContentMap} contentMap
 * @param {object[]} implicitEntities
 * @returns {object}
 */
export function buildLdDocument(collected, contentMap, implicitEntities = []) {
  /** @type {Record<string, unknown>} */
  const doc = {};

  for (const [k, v] of Object.entries(collected.root ?? {})) {
    doc[normalizeLdKey(k)] = resolveRefs(v, contentMap);
  }

  /** @type {object[]} */
  const entities = [];
  /** @type {unknown[]} */
  const extraContexts = [];

  /** @param {unknown} resolved @param {string|undefined} graphId */
  const adopt = (resolved, graphId) => {
    if (!isPlainObject(resolved)) return;
    const entity = /** @type {Record<string, unknown>} */ (resolved);
    if (entity['@context'] !== undefined) {
      extraContexts.push(entity['@context']);
      delete entity['@context'];
    }
    if (graphId && entity['@id'] === undefined) entity['@id'] = graphId;
    entities.push(entity);
  };

  for (const entry of collected.blocks ?? []) {
    const { block, graphId } = unwrapEntry(entry);
    adopt(resolveRefs(block, contentMap), graphId);
  }

  for (const entry of collected.conditionals ?? []) {
    const { block: cond, graphId } = unwrapEntry(entry);
    const ok = evaluateCondition(cond.condition, contentMap);
    const branch = ok ? cond.then : cond.else;
    if (branch) {
      adopt(resolveRefs(branch, contentMap), graphId);
    }
  }

  for (const e of implicitEntities) {
    adopt(e, undefined);
  }

  const merged = mergeById(entities);

  if (extraContexts.length > 0) {
    doc['@context'] = mergeContexts(doc['@context'], extraContexts);
  }

  if (merged.length === 1 && Object.keys(doc).length <= 2) {
    // Merge single entity into root document
    Object.assign(doc, merged[0]);
  } else if (merged.length > 0) {
    doc['@graph'] = merged;
  }

  if (!doc['@context']) {
    doc['@context'] = 'https://schema.org';
  }

  return doc;
}
