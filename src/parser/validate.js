/**
 * Strict validation for Verso trees — opt-in via `--strict` or VERSO_STRICT=1.
 *
 * The renderer is deliberately lenient: shapes it doesn't understand are
 * skipped or stringified. Strict mode turns the common silent failures into
 * errors: ld/ld_if at the top level, attribute-like top-level keys,
 * non-mapping ld blocks, malformed ld_if conditions, and { ref } objects
 * that would never resolve.
 */

import { ConventionRegistry } from './conventions.js';

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
 */
export function validateTree(tree) {
  if (!isPlainObject(tree)) {
    throw new VersoValidationError('Verso root must be a mapping');
  }
  for (const [key, value] of Object.entries(tree)) {
    validateTopLevel(key, value);
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function validateTopLevel(key, value) {
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
  validateElement(value, key, key);
}

/**
 * @param {unknown} value element value: scalar shorthand, child list, or mapping
 * @param {string} path
 * @param {string} [key] the key this value sits under, when known
 */
function validateElement(value, path, key) {
  if (Array.isArray(value)) {
    // Only convention shorthand arrays (product: [ {...} ]) hold element
    // bodies; every other list holds element-position maps ({ tag: ... }).
    const entityArray = key != null && Boolean(ConventionRegistry[key.toLowerCase()]);
    value.forEach((item, i) => {
      if (!isPlainObject(item)) return;
      if (entityArray) {
        validateEntryMap(item, `${path}[${i}]`);
      } else {
        for (const [k, v] of Object.entries(item)) {
          validateElement(v, `${path}[${i}].${k}`, k);
        }
      }
    });
    return;
  }
  if (isPlainObject(value)) validateEntryMap(value, path);
}

/**
 * Walk one mapping of key → value entries (an element body or a child item).
 * @param {Record<string, unknown>} obj
 * @param {string} path
 */
function validateEntryMap(obj, path) {
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
    if (
      (SCALAR_VALUE_KEYS.has(k) || k.startsWith('data-') || k.startsWith('aria-')) &&
      (isPlainObject(v) || Array.isArray(v))
    ) {
      throw new VersoValidationError(
        `"${k}" must be a scalar, not ${Array.isArray(v) ? 'a list' : 'a mapping'}`,
        `${path}.${k}`,
      );
    }
    if (isPlainObject(v) || Array.isArray(v)) {
      validateElement(v, `${path}.${k}`, k);
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
    if (cond.ref !== undefined && typeof cond.ref !== 'string') {
      throw new VersoValidationError(
        '"ld_if.condition.ref" must be a selector string like "#id .class"',
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
