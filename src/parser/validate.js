/**
 * Strict validation for Verso trees — opt-in via `--strict` or VERSO_STRICT=1.
 *
 * The renderer is deliberately lenient: shapes it doesn't understand are
 * skipped or stringified. Strict mode turns the common silent failures into
 * errors: ld/ld_if at the top level, attribute-like top-level keys,
 * non-mapping ld blocks, malformed ld_if conditions, and { ref } objects
 * that would never resolve.
 */

import { ConventionRegistry, matchConventions } from './conventions.js';
import { isKeyRef } from './keys.js';

/** Comparison operators understood by ldResolver's compare(). */
const OPERATORS = new Set(['<', '>', '<=', '>=', '==', '!=', 'contains', 'exists']);

/**
 * Attribute / text / structural keys that are meaningful inside an element
 * but render as bogus custom elements when used as top-level tags.
 * (`title`, `style`, `script` etc. are real tags and stay allowed.)
 */
const NON_TAG_TOP_LEVEL = new Set([
  'id', 'class', 'href', 'src', 'alt', 'type', 'name', 'value', 'placeholder',
  'action', 'method', 'target', 'rel', 'role', 'width', 'height', 'for',
  'checked', 'disabled', 'readonly', 'required', 'colspan', 'rowspan',
  'contenteditable',
  'text', 'content', '_text',
  'children', '$',
]);

/**
 * Keys whose values must be scalars inside an element body (attribute and
 * text keys). children/$ are excluded — they have their own list check.
 */
const SCALAR_VALUE_KEYS = new Set([
  'id', 'class', 'href', 'src', 'alt', 'type', 'name', 'value', 'placeholder',
  'action', 'method', 'target', 'rel', 'role', 'width', 'height', 'for',
  'checked', 'disabled', 'readonly', 'required', 'colspan', 'rowspan',
  'contenteditable',
  'text', 'content', '_text',
  'title',
]);

export class VersoValidationError extends Error {
  /**
   * @param {string} message
   * @param {string} [path] dot-path to the offending key
   */
  constructor(message, path) {
    super(path ? `${message} (at ${path})` : message);
    this.name = 'VersoValidationError';
    this.path = path;
  }
}

const isPlainObject = (v) =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Env fallback for strict mode when options.strict is not set. */
export function strictFromEnv() {
  return /^(1|true|yes)$/i.test(process.env.VERSO_STRICT ?? '');
}

/**
 * Validate a parsed, includes-resolved Verso tree.
 * Throws VersoValidationError on the first problem found.
 * @param {unknown} tree
 * @param {{ registry?: Record<string, unknown>, conventions?: Record<string, unknown>, keys?: Record<string, unknown> }} [options]
 *   registry: resolved convention registry (for entity-shorthand arrays).
 *   conventions / keys: harvested file-root blocks, validated here because
 *   include resolution strips them from the tree.
 */
export function validateTree(tree, options = {}) {
  if (!isPlainObject(tree)) {
    throw new VersoValidationError('Verso root must be a mapping');
  }
  if (options.conventions !== undefined) {
    validateConventionsBlock(options.conventions, options.registry ?? {});
  }
  if (options.keys !== undefined) {
    validateKeysBlock(options.keys);
  }
  const registry = options.registry ?? ConventionRegistry;
  for (const [key, value] of Object.entries(tree)) {
    validateTopLevel(key, value, registry);
  }
}

/**
 * Validate a harvested YAML `conventions:` block. Inheritance itself is
 * resolved leniently elsewhere; strict mode pins the declared shapes down.
 * @param {Record<string, unknown>} conventions
 * @param {Record<string, unknown>} registry merged registry (extends targets)
 */
function validateConventionsBlock(conventions, registry) {
  const ALLOWED = new Set(['type', 'fields', 'extends', 'requires']);
  for (const [name, def] of Object.entries(conventions)) {
    const path = `conventions.${name}`;
    if (!isPlainObject(def)) {
      throw new VersoValidationError(
        `convention "${name}" must be a mapping of { type, fields, extends, requires }`,
        path,
      );
    }
    for (const k of Object.keys(def)) {
      if (!ALLOWED.has(k)) {
        throw new VersoValidationError(
          `unknown convention key "${k}" — YAML conventions support type, fields, extends, requires only (transform is JS-only)`,
          `${path}.${k}`,
        );
      }
    }
    if (def.extends !== undefined) {
      if (typeof def.extends !== 'string') {
        throw new VersoValidationError('"extends" must be a convention name', `${path}.extends`);
      }
      if (def.extends === name) {
        throw new VersoValidationError(
          `convention "${name}" cannot extend itself`,
          `${path}.extends`,
        );
      }
      if (!(def.extends in registry) && !(def.extends in conventions)) {
        throw new VersoValidationError(
          `convention "${name}" extends unknown convention "${def.extends}"`,
          `${path}.extends`,
        );
      }
    }
    if (def.type !== undefined && typeof def.type !== 'string') {
      throw new VersoValidationError('"type" must be a string', `${path}.type`);
    }
    if (def.extends === undefined && def.type === undefined) {
      throw new VersoValidationError(
        `convention "${name}" needs a "type" (or an "extends" to inherit one)`,
        path,
      );
    }
    if (def.fields !== undefined) {
      if (!isPlainObject(def.fields)) {
        throw new VersoValidationError(
          '"fields" must be a mapping of JSON-LD property → selector string',
          `${path}.fields`,
        );
      }
      for (const [prop, sel] of Object.entries(def.fields)) {
        if (typeof sel !== 'string') {
          throw new VersoValidationError(
            `"fields.${prop}" must be a selector string like ".price"`,
            `${path}.fields.${prop}`,
          );
        }
      }
    }
    if (def.requires !== undefined) {
      if (!Array.isArray(def.requires) || def.requires.some((r) => typeof r !== 'string')) {
        throw new VersoValidationError(
          '"requires" must be a list of selector strings',
          `${path}.requires`,
        );
      }
    }
  }
}

/**
 * Validate a harvested `keys:` block: each value is a string (literal text
 * or an include path), a { ref: "selector" }, or a { href: "url" }.
 * @param {Record<string, unknown>} keys
 */
function validateKeysBlock(keys) {
  for (const [name, v] of Object.entries(keys)) {
    const path = `keys.${name}`;
    if (typeof v === 'string') continue;
    if (isPlainObject(v) && Object.keys(v).length === 1) {
      if (typeof v.ref === 'string' || typeof v.href === 'string') continue;
    }
    throw new VersoValidationError(
      `key "${name}" must be a string, a { ref: "selector" } or a { href: "url" }`,
      path,
    );
  }
}

/**
 * Post-render strict checks, run against the built ContentMap:
 * - every element matching a convention with `requires:` must have each
 *   required selector scoped to its id (e.g. "#car_7 .name")
 * - every ref-valued key used in ld:/ld_if must resolve to a ContentMap entry
 * @param {{ contentMap: import('./contentMap.js').ContentMap, trackedElements: Array<{ id?: string, classes: string[], graphId?: string }>, registry: Record<string, import('./conventions.js').ResolvedConvention>, refKeyUsages?: Array<{ name: string, selector: string, path: string }> }} args
 */
export function validateRendered({ contentMap, trackedElements, registry, refKeyUsages = [] }) {
  for (const el of trackedElements) {
    for (const [trigger, conv] of matchConventions(el.classes ?? [], registry)) {
      for (const sel of conv.requires ?? []) {
        const scoped = el.id ? `#${el.id} ${sel}` : sel;
        if (contentMap.get(scoped) === undefined) {
          throw new VersoValidationError(
            `convention "${trigger}" requires "${sel}" but the ContentMap has no entry for "${scoped}"`,
            el.id ? `#${el.id}` : `.${trigger}`,
          );
        }
      }
    }
  }
  for (const usage of refKeyUsages) {
    if (contentMap.get(usage.selector) === undefined) {
      throw new VersoValidationError(
        `key "${usage.name}" points at selector "${usage.selector}" with no ContentMap entry after render`,
        usage.path,
      );
    }
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {Record<string, unknown>} registry
 */
function validateTopLevel(key, value, registry) {
  if (key.startsWith('@')) {
    validateRefs(value, key);
    return;
  }
  if (key === 'ld' || key === 'ld_if') {
    throw new VersoValidationError(
      `"${key}" is silently ignored at the top level — nest it under an element`,
      key,
    );
  }
  if (key === 'head') return; // document head block, loosely structured by design
  if (key === 'keys' || key === 'conventions') {
    // Well-formed blocks are harvested and stripped before validation;
    // reaching here means the block wasn't a mapping.
    throw new VersoValidationError(
      `"${key}" must be a mapping — it is harvested at the file root, never rendered`,
      key,
    );
  }
  if (
    NON_TAG_TOP_LEVEL.has(key) ||
    key.startsWith('data-') ||
    key.startsWith('aria-')
  ) {
    throw new VersoValidationError(
      `"${key}" is an attribute/text key and renders as a bogus <${key}> element at the top level`,
      key,
    );
  }
  validateElement(value, key, key, registry);
}

/**
 * @param {unknown} value element value: scalar shorthand, child list, or mapping
 * @param {string} path
 * @param {string} [key] the key this value sits under, when known
 * @param {Record<string, unknown>} [registry]
 */
function validateElement(value, path, key, registry = ConventionRegistry) {
  if (Array.isArray(value)) {
    // Only convention shorthand arrays (product: [ {...} ]) hold element
    // bodies; every other list holds element-position maps ({ tag: ... }).
    const entityArray = key != null && Boolean(registry[key.toLowerCase()]);
    value.forEach((item, i) => {
      if (!isPlainObject(item)) return;
      if (entityArray) {
        validateEntryMap(item, `${path}[${i}]`, registry);
      } else {
        for (const [k, v] of Object.entries(item)) {
          validateElement(v, `${path}[${i}].${k}`, k, registry);
        }
      }
    });
    return;
  }
  if (isPlainObject(value)) validateEntryMap(value, path, registry);
}

/**
 * Walk one mapping of key → value entries (an element body or a child item).
 * @param {Record<string, unknown>} obj
 * @param {string} path
 * @param {Record<string, unknown>} [registry]
 */
function validateEntryMap(obj, path, registry = ConventionRegistry) {
  if (obj.ld !== undefined) validateLdBlock(obj.ld, `${path}.ld`);
  if (obj.ld_if !== undefined) validateLdIf(obj.ld_if, `${path}.ld_if`);

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'ld' || k === 'ld_if' || k.startsWith('@')) continue;

    if ((k === 'children' || k === '$') && !Array.isArray(v)) {
      throw new VersoValidationError(
        `"${k}" must be a list of child elements`,
        `${path}.${k}`,
      );
    }
    // { key: name } references stay mappings until post-validation key
    // resolution — exempt them from the scalar check here.
    if (
      (SCALAR_VALUE_KEYS.has(k) || k.startsWith('data-') || k.startsWith('aria-')) &&
      (isPlainObject(v) || Array.isArray(v)) &&
      !isKeyRef(v)
    ) {
      throw new VersoValidationError(
        `"${k}" must be a scalar, not ${Array.isArray(v) ? 'a list' : 'a mapping'}`,
        `${path}.${k}`,
      );
    }
    if (isKeyRef(v)) continue;
    if (isPlainObject(v) || Array.isArray(v)) {
      validateElement(v, `${path}.${k}`, k, registry);
    }
  }
}

/**
 * @param {unknown} ld
 * @param {string} path
 */
function validateLdBlock(ld, path) {
  if (!isPlainObject(ld)) {
    throw new VersoValidationError(
      '"ld" must be a mapping of JSON-LD properties — other shapes are silently dropped',
      path,
    );
  }
  validateRefs(ld, path);
}

/**
 * @param {unknown} ldIf
 * @param {string} path
 */
function validateLdIf(ldIf, path) {
  if (!isPlainObject(ldIf)) {
    throw new VersoValidationError(
      '"ld_if" must be a mapping with "condition" and "then"/"else" branches',
      path,
    );
  }

  const cond = ldIf.condition;
  if (cond === undefined) {
    throw new VersoValidationError('"ld_if" requires a "condition"', path);
  }
  if (typeof cond !== 'string') {
    if (!isPlainObject(cond)) {
      throw new VersoValidationError(
        '"ld_if.condition" must be a string like "#id .price < 100" or a { ref, operator, value } mapping',
        `${path}.condition`,
      );
    }
    if (cond.ref !== undefined && typeof cond.ref !== 'string' && !isKeyRef(cond.ref)) {
      throw new VersoValidationError(
        '"ld_if.condition.ref" must be a selector string like "#id .class" (or a { key } reference)',
        `${path}.condition`,
      );
    }
    if (cond.operator !== undefined && !OPERATORS.has(String(cond.operator))) {
      throw new VersoValidationError(
        `unknown ld_if operator "${cond.operator}" — expected one of: ${[...OPERATORS].join(', ')}`,
        `${path}.condition`,
      );
    }
  }

  for (const branch of ['then', 'else']) {
    const b = ldIf[branch];
    if (b === undefined) continue;
    if (!isPlainObject(b)) {
      throw new VersoValidationError(
        `"ld_if.${branch}" must be a mapping of JSON-LD properties — other shapes are silently dropped`,
        `${path}.${branch}`,
      );
    }
    validateRefs(b, `${path}.${branch}`);
  }
  if (ldIf.then === undefined && ldIf.else === undefined) {
    throw new VersoValidationError('"ld_if" requires at least a "then" branch', path);
  }
}

/**
 * Recursively check { ref } shapes. resolveRefs() only resolves an object
 * whose sole key is a string "ref" — anything else passes through silently.
 * @param {unknown} node
 * @param {string} path
 */
function validateRefs(node, path) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => validateRefs(item, `${path}[${i}]`));
    return;
  }
  if (!isPlainObject(node)) return;
  if ('ref' in node) {
    if (typeof node.ref !== 'string') {
      throw new VersoValidationError(
        '"ref" must be a selector string like "#id .class"',
        path,
      );
    }
    if (Object.keys(node).length > 1) {
      throw new VersoValidationError(
        '{ ref } only resolves when "ref" is the sole key — extra keys keep it a plain object',
        path,
      );
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    validateRefs(v, `${path}.${k}`);
  }
}
