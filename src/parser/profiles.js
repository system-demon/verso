/**
 * Verso profiles — presentation-side `if:` / `flag:` conditionals (P4, ditaval-lite)
 *
 * Answers "who is this rendering for?" — a different axis from `ld_if`
 * ("what does the data imply for the graph?"). Conditions are evaluated
 * against a PROFILE (a plain map of profiling attributes supplied per
 * render), never against the ContentMap, and run BEFORE include/params/key
 * resolution so excluded content never renders and never asserts into the
 * graph. `ld_if` by contrast evaluates post-render over rendered values.
 *
 *   div: { class: "admin-panel", if: { audience: admin } }   # render gated
 *   p:   { if: "platform == 'web'", text: "..." }            # string form
 *   span: { flag: { audience: novice }, text: "..." }        # kept; gains
 *                                                            #   class flag-novice
 *
 * Profile vocabulary is fixed: audience, platform, product.
 * No profile supplied → everything renders, unflagged (filtering is opt-in).
 */

import { VersoValidationError } from './validate.js';

const PROFILE_VOCAB = new Set(['audience', 'platform', 'product']);

/**
 * Keys whose values are data blocks, not elements — `if`/`flag` inside them
 * are ordinary data keys and must not be read as conditions.
 */
const DATA_KEYS = new Set(['ld', 'ld_if', 'keys', 'conventions', 'head']);

/** Marker for "this node failed its if: condition". */
const EXCLUDE = Symbol('verso-profile-exclude');

/**
 * String condition grammar: `attribute == 'value'` / `attribute != value`.
 * == and != only; left side is a profiling attribute name; right side a
 * single-quoted, double-quoted, or bare string (no numeric operators).
 */
const CONDITION_RE = /^([A-Za-z_]\w*)\s*(==|!=)\s*(?:'([^']*)'|"([^"]*)"|([^\s='"!][^\s]*))\s*$/;

const PARAM_PAIR_RE = /^([A-Za-z_]\w*)=(.*)$/;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalize a profile supplied by a caller (CLI pairs or an RPC/JS object).
 * Returns undefined when no profile was supplied — filtering is opt-in per
 * render. An explicitly empty profile ({}) is "supplied": every `if:` fails.
 * Unknown profiling attributes and malformed pairs throw immediately — a
 * typo here would silently exclude content.
 * @param {Record<string, unknown> | string[] | undefined | null} input
 * @returns {Record<string, string> | undefined}
 */
export function parseProfile(input) {
  if (input === undefined || input === null) return undefined;

  /** @type {Array<[string, unknown]>} */
  let pairs;
  if (Array.isArray(input)) {
    pairs = input.map((entry) => {
      const m = String(entry).match(PARAM_PAIR_RE);
      if (!m) {
        throw new Error(
          `Verso profile entries must be key=value pairs (got "${entry}")`,
        );
      }
      return [m[1], m[2]];
    });
  } else if (isPlainObject(input)) {
    pairs = Object.entries(input);
  } else {
    throw new Error(
      'Verso profile must be a plain object or an array of key=value strings',
    );
  }

  /** @type {Record<string, string>} */
  const profile = {};
  for (const [key, value] of pairs) {
    if (!PROFILE_VOCAB.has(key)) {
      throw new Error(
        `unknown profiling attribute "${key}" — profile vocabulary: ${[...PROFILE_VOCAB].join(', ')}`,
      );
    }
    if (value !== undefined && value !== null) profile[key] = String(value);
  }
  return profile;
}

/**
 * Parse the string condition form, or return null when malformed.
 * @param {string} expr
 * @returns {{ name: string, op: '==' | '!=', value: string } | null}
 */
function parseStringCondition(expr) {
  const m = expr.trim().match(CONDITION_RE);
  if (!m) return null;
  const value = m[3] ?? m[4] ?? m[5];
  if (value === undefined) return null;
  return { name: m[1], op: /** @type {'==' | '!='} */ (m[2]), value };
}

/**
 * Strict-mode shape validation for one `if:` / `flag:` condition.
 * Throws VersoValidationError naming the condition's path. Lenient mode
 * never calls this — malformed conditions are simply non-matching there.
 * @param {unknown} cond
 * @param {string} path
 */
export function validateCondition(cond, path) {
  if (typeof cond === 'string') {
    const parsed = parseStringCondition(cond);
    if (!parsed) {
      throw new VersoValidationError(
        `malformed condition "${cond}" — expected: <attribute> ==|!= 'value' (== and != only)`,
        path,
      );
    }
    if (!PROFILE_VOCAB.has(parsed.name)) {
      throw new VersoValidationError(
        `unknown profiling attribute "${parsed.name}" — profile vocabulary: ${[...PROFILE_VOCAB].join(', ')}`,
        path,
      );
    }
    return;
  }
  if (isPlainObject(cond)) {
    const entries = Object.entries(cond);
    if (entries.length === 0) {
      throw new VersoValidationError(
        'empty condition — name at least one profiling attribute (audience, platform, product)',
        path,
      );
    }
    for (const [key, value] of entries) {
      if (!PROFILE_VOCAB.has(key)) {
        throw new VersoValidationError(
          `unknown profiling attribute "${key}" — profile vocabulary: ${[...PROFILE_VOCAB].join(', ')}`,
          path,
        );
      }
      if (typeof value !== 'string') {
        throw new VersoValidationError(
          `condition value for "${key}" must be a string (got ${Array.isArray(value) ? 'array' : typeof value})`,
          path,
        );
      }
    }
    return;
  }
  throw new VersoValidationError(
    'condition must be a map of profiling attributes or a string like "audience == \'admin\'"',
    path,
  );
}

/**
 * Lenient condition check. Any malformation (bad shape, unknown attribute,
 * non-string value) is non-matching — mirror of the strict error categories.
 * A missing profile attribute compares as absent: `==` fails, `!=` holds.
 * @param {unknown} cond
 * @param {Record<string, string>} profile
 * @returns {boolean}
 */
function matchCondition(cond, profile) {
  if (typeof cond === 'string') {
    const parsed = parseStringCondition(cond);
    if (!parsed || !PROFILE_VOCAB.has(parsed.name)) return false;
    const actual = profile[parsed.name];
    return parsed.op === '==' ? actual === parsed.value : actual !== parsed.value;
  }
  if (isPlainObject(cond)) {
    const entries = Object.entries(cond);
    if (entries.length === 0) return false;
    if (
      !entries.every(
        ([key, value]) => PROFILE_VOCAB.has(key) && typeof value === 'string',
      )
    ) {
      return false;
    }
    return entries.every(([key, value]) => profile[key] === value);
  }
  return false;
}

/**
 * Marker classes contributed by a `flag:` condition: empty unless the whole
 * condition matches the profile, then one `flag-<value>` per condition pair
 * (string form: the right-hand side). Multiple matched pairs add multiple
 * classes.
 * @param {unknown} cond
 * @param {Record<string, string>} profile
 * @returns {string[]}
 */
function flagClasses(cond, profile) {
  if (typeof cond === 'string') {
    const parsed = parseStringCondition(cond);
    if (!parsed || !PROFILE_VOCAB.has(parsed.name)) return [];
    const actual = profile[parsed.name];
    const ok = parsed.op === '==' ? actual === parsed.value : actual !== parsed.value;
    return ok ? [parsed.value] : [];
  }
  if (isPlainObject(cond)) {
    const entries = Object.entries(cond);
    if (entries.length === 0) return [];
    if (
      !entries.every(
        ([key, value]) => PROFILE_VOCAB.has(key) && typeof value === 'string',
      )
    ) {
      return [];
    }
    return entries.every(([key, value]) => profile[key] === value)
      ? entries.map(([, value]) => value)
      : [];
  }
  return [];
}

/**
 * @param {unknown} existing existing class attribute
 * @param {string[]} additions flag values to append as flag-<value>
 */
function addFlagClasses(existing, additions) {
  const parts = String(existing ?? '').split(/\s+/).filter(Boolean);
  for (const value of additions) {
    const cls = `flag-${value}`;
    if (!parts.includes(cls)) parts.push(cls);
  }
  return parts.join(' ');
}

/**
 * Apply profile conditionality to a parsed YAML tree: prune elements whose
 * `if:` fails the profile, annotate elements whose `flag:` matches with
 * `flag-<value>` classes, and strip the condition keys so downstream stages
 * never see them. With no profile (undefined) nothing is pruned or flagged —
 * the pass is a structural no-op beyond key stripping.
 *
 * Shape validation runs whenever strict is set (with or without a profile).
 * Data blocks (ld:, ld_if, keys:, conventions:, head:, @*) are passed through
 * untouched.
 *
 * @param {Record<string, unknown>} tree parsed YAML root
 * @param {Record<string, string> | undefined} profile normalized profile
 * @param {{ strict?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
export function filterTree(tree, profile, options = {}) {
  if (!isPlainObject(tree)) return tree;
  const ctx = {
    filtering: profile !== undefined && profile !== null,
    profile: profile ?? {},
    strict: options.strict ?? false,
  };
  return filterMap(tree, '', ctx);
}

/**
 * @param {Record<string, unknown>} map
 * @param {string} path
 * @param {{ filtering: boolean, profile: Record<string, string>, strict: boolean }} ctx
 */
function filterMap(map, path, ctx) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    const keyPath = path ? `${path} > ${key}` : key;
    if (DATA_KEYS.has(key) || key.startsWith('@')) {
      out[key] = value;
      continue;
    }
    const filtered = filterValue(value, keyPath, ctx);
    if (filtered !== EXCLUDE) out[key] = filtered;
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ filtering: boolean, profile: Record<string, string>, strict: boolean }} ctx
 * @returns {unknown} filtered value, or EXCLUDE
 */
function filterValue(value, path, ctx) {
  if (Array.isArray(value)) {
    /** @type {unknown[]} */
    const out = [];
    value.forEach((item, i) => {
      const filtered = filterValue(item, `${path}[${i}]`, ctx);
      if (filtered === EXCLUDE) return;
      // An array item whose only key(s) were all excluded leaves an empty
      // shell — drop the item rather than render nothingness.
      if (isPlainObject(filtered) && isPlainObject(item)) {
        if (Object.keys(filtered).length === 0 && Object.keys(item).length > 0) return;
      }
      out.push(filtered);
    });
    return out;
  }
  if (!isPlainObject(value)) return value;
  return filterElement(value, path, ctx);
}

/**
 * One element-value object: validate its condition shapes (strict), drop it
 * when its `if:` fails (filtering only), merge flag classes, then recurse.
 * @param {Record<string, unknown>} obj
 * @param {string} path
 * @param {{ filtering: boolean, profile: Record<string, string>, strict: boolean }} ctx
 * @returns {unknown} filtered object, or EXCLUDE
 */
function filterElement(obj, path, ctx) {
  const hasIf = 'if' in obj;
  const hasFlag = 'flag' in obj;

  if (ctx.strict) {
    if (hasIf) validateCondition(obj.if, `${path} > if`);
    if (hasFlag) validateCondition(obj.flag, `${path} > flag`);
  }

  if (ctx.filtering && hasIf && !matchCondition(obj.if, ctx.profile)) {
    return EXCLUDE;
  }

  let kept = obj;
  if (hasIf || hasFlag) {
    kept = { ...obj };
    delete kept.if;
    delete kept.flag;
    if (ctx.filtering && hasFlag) {
      const additions = flagClasses(obj.flag, ctx.profile);
      if (additions.length) kept.class = addFlagClasses(obj.class, additions);
    }
  }

  return filterMap(kept, path, ctx);
}
