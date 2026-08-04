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
 *   or string form "price < 20" (legacy / simple)
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
  const operator = condition.operator ?? '==';
  const target = condition.value;

  return compare(ref, operator, target);
}

/**
 * @param {string} expr
 * @param {import('./contentMap.js').ContentMap} contentMap
 */
function evaluateStringCondition(expr, contentMap) {
  const m = expr.trim().match(/^(.+?)\s*(<=|>=|==|!=|<|>|contains)\s*(.+)$/);
  if (!m) return false;
  const [, leftRaw, op, rightRaw] = m;
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
 * Process collected ld / ld_if blocks into a final JSON-LD graph.
 * @param {{ root: Record<string, unknown>, blocks: object[], conditionals: object[] }} collected
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

  const entities = [];

  for (const block of collected.blocks ?? []) {
    entities.push(/** @type {object} */ (resolveRefs(block, contentMap)));
  }

  for (const cond of collected.conditionals ?? []) {
    const ok = evaluateCondition(cond.condition, contentMap);
    const branch = ok ? cond.then : cond.else;
    if (branch) {
      entities.push(/** @type {object} */ (resolveRefs(branch, contentMap)));
    }
  }

  entities.push(...implicitEntities);

  if (entities.length === 1 && Object.keys(doc).length <= 2) {
    // Merge single entity into root document
    Object.assign(doc, entities[0]);
  } else if (entities.length > 0) {
    doc['@graph'] = entities;
  }

  if (!doc['@context']) {
    doc['@context'] = 'https://schema.org';
  }

  return doc;
}
