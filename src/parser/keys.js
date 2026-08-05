/**
 * Verso keys — DITA-flavored symbolic names bound in a top-level `keys:` block.
 *
 *   keys:
 *     product-name: "WonderWidget"      # literal text (also .yml include paths)
 *     price: { ref: "#item_1 .price" }  # named selector, resolved post-render
 *     support: { href: "/support" }     # named link
 *     logo: "partials/logo.yml"         # named include resource
 *
 * `{ key: name }` anywhere a value appears resolves against the merged keys
 * (including-file keys win over included-file keys — first definition wins).
 * Literal/href values substitute pre-render, right after {{param}} injection.
 * Ref-valued keys are restricted to ld:/ld_if positions: they rewrite to the
 * equivalent { ref } there and resolve post-render against the ContentMap.
 */

/**
 * True for a mapping whose sole key is `key` with a string value — the
 * `{ key: name }` reference shape.
 * @param {unknown} v
 */
export function isKeyRef(v) {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (/** @type {{ key?: unknown }} */ (v).key) === 'string' &&
    Object.keys(v).length === 1
  );
}

/**
 * Resolve an include-by-key reference to a partial path. Includes are
 * structural, so an unresolvable key fails fast in lenient mode too.
 * @param {string} name
 * @param {Record<string, unknown>} keys
 * @returns {string}
 */
export function includePathFromKey(name, keys) {
  if (!(name in keys)) {
    throw new Error(
      `Verso include key not defined: "${name}" — declare it in a top-level keys: block`,
    );
  }
  const value = keys[name];
  if (typeof value === 'string') return value;
  const kind =
    value && typeof value === 'object'
      ? 'ref' in value
        ? 'ref-valued'
        : 'href-valued'
      : 'non-string';
  throw new Error(
    `Verso include key "${name}" must be a path string (e.g. "partials/logo.yml") — got a ${kind} key`,
  );
}

/**
 * @param {string} message
 * @param {string} path
 */
function keyError(message, path) {
  return new Error(path ? `${message} (at ${path})` : message);
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} keys
 * @param {string} path dot-path for error context
 * @param {boolean} inLd inside an ld:/ld_if (or root @*) subtree
 * @param {Array<{ name: string, selector: string, path: string }>} refKeyUsages
 * @param {{ strict?: boolean }} options
 * @returns {unknown}
 */
function resolveKeyRef(name, keys, path, inLd, refKeyUsages, options) {
  if (!(name in keys)) {
    if (options.strict) {
      throw keyError(
        `unknown key "${name}" — declare it in a top-level keys: block`,
        path,
      );
    }
    return null;
  }
  const value = keys[name];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.href === 'string') return value.href;
    if (typeof value.ref === 'string') {
      if (inLd) {
        refKeyUsages.push({ name, selector: value.ref, path });
        return { ref: value.ref };
      }
      if (options.strict) {
        throw keyError(
          `key "${name}" is ref-valued — ref keys are only allowed in ld:/ld_if values (they resolve post-render)`,
          path,
        );
      }
      return null;
    }
  }
  if (options.strict) {
    throw keyError(
      `key "${name}" must be a string, a { ref: "selector" } or a { href: "url" }`,
      path,
    );
  }
  return null;
}

/**
 * Substitute `{ key: name }` references throughout a fully-included,
 * params-injected tree. Literal and href values become strings in place;
 * ref-valued keys become `{ ref }` objects inside ld:/ld_if subtrees and are
 * recorded so strict mode can verify their selectors post-render.
 * @param {unknown} tree
 * @param {Record<string, unknown>} keys
 * @param {{ strict?: boolean }} [options]
 * @returns {{ tree: unknown, refKeyUsages: Array<{ name: string, selector: string, path: string }> }}
 */
export function resolveKeys(tree, keys = {}, options = {}) {
  /** @type {Array<{ name: string, selector: string, path: string }>} */
  const refKeyUsages = [];

  /**
   * @param {unknown} node
   * @param {string} path
   * @param {boolean} inLd
   * @returns {unknown}
   */
  const walk = (node, path, inLd) => {
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${path}[${i}]`, inLd));
    }
    if (node && typeof node === 'object') {
      if (isKeyRef(node)) {
        return resolveKeyRef(
          /** @type {{ key: string }} */ (node).key,
          keys,
          path,
          inLd,
          refKeyUsages,
          options,
        );
      }
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        const childLd =
          inLd || k === 'ld' || k === 'ld_if' || k.startsWith('@');
        out[k] = walk(v, path ? `${path}.${k}` : k, childLd);
      }
      return out;
    }
    return node;
  };

  return { tree: walk(tree, '', false), refKeyUsages };
}
