/**
 * Twinseed includes — inline another YAML tree via `include: "partial.yml"`
 * (or `include: { key: name }` via a keys-declared path).
 * Paths resolve relative to the including file; cycles and runaway
 * depth fail fast with a readable chain. Runs before {{param}} injection
 * so placeholders inside partials are filled from the same params.
 *
 * Element-level includes (P5, conref-lite): a path may carry a fragment —
 * `include: "partials/legal.yml#copyright"` pulls just the element whose
 * `id:` attribute matches, from the partial's fully-resolved tree (nested
 * includes processed first, so ids inside deeper partials are addressable).
 * The pulled element keeps its own tag in place of the including node's key;
 * the including node's other keys merge over it via the same merge as
 * whole-file map partials. A keys-declared path may carry the fragment too
 * (`include: { key: name }` → conkeyref). The #id portion is stripped
 * before path resolution, so cycle/depth accounting keys on the file alone.
 *
 * File-root `keys:` and `conventions:` blocks are harvested here as files
 * load: an including file's declarations propagate into its partials, and
 * the first definition of a name wins (a partial cannot shadow its parent).
 *
 * Map documents (map.js) additionally pass a `contexts` array in the
 * collector, opting into the map cascade policy at every loaded file root:
 * the fragment's @context is collected (the publication merges them, deduped)
 * and its head: is dropped (the map owns the composed document's head).
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { preprocessYaml } from './yamlDom.js';
import { isKeyRef, includePathFromKey } from './keys.js';

const MAX_DEPTH = 20;

const isPlainObject = (v) =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Resolve every `include:` key in a parsed YAML tree.
 * @param {unknown} node
 * @param {{ baseDir?: string, chain?: string[], collect?: { keys: Record<string, unknown>, conventions: Record<string, unknown> } }} [options]
 *   collect receives the harvested file-root keys:/conventions: declarations
 *   (created when omitted); first definition of a name wins along the chain.
 * @returns {unknown}
 */
export function resolveIncludes(node, options = {}) {
  const collect = options.collect ?? { keys: {}, conventions: {} };
  const harvested = harvestFileRoot(node, collect);
  return walk(harvested, options.baseDir, options.chain ?? [], 0, collect);
}

/**
 * Collect file-root `keys:` / `conventions:` blocks into the per-render
 * collector and strip them from the tree so they never render as elements.
 * Non-mapping blocks are left in place for strict validation to flag.
 * When collect.contexts is an array (map documents only), the file-root
 * @context is collected for merging and head: is stripped — maps own the
 * composed document's context and head.
 * @param {unknown} node
 * @param {{ keys: Record<string, unknown>, conventions: Record<string, unknown>, contexts?: unknown[] }} collect
 * @returns {unknown}
 */
function harvestFileRoot(node, collect) {
  if (!isPlainObject(node)) return node;
  const obj = { ...node };
  for (const metaKey of ['keys', 'conventions']) {
    if (!(metaKey in obj)) continue;
    const val = obj[metaKey];
    if (val === null || val === undefined || isPlainObject(val)) {
      if (isPlainObject(val)) {
        const target = collect[metaKey];
        for (const [k, v] of Object.entries(val)) {
          if (!(k in target)) target[k] = v;
        }
      }
      delete obj[metaKey];
    }
  }
  if (Array.isArray(collect.contexts)) {
    if (obj['@context'] !== undefined && obj['@context'] !== null) {
      collect.contexts.push(obj['@context']);
    }
    delete obj['@context'];
    delete obj.head;
  }
  return obj;
}

function walk(node, baseDir, chain, depth, collect) {
  if (depth > MAX_DEPTH) {
    throw new Error(
      `include depth exceeded ${MAX_DEPTH}: ${chain.join(' → ')}`,
    );
  }

  if (Array.isArray(node)) {
    const out = [];
    for (const item of node) {
      if (isIncludeOnly(item)) {
        const rel = includeTarget(item.include, collect);
        const { content } = loadIncludeContent(rel, baseDir, chain, depth, collect);
        if (Array.isArray(content)) out.push(...content);
        else out.push(content);
      } else {
        out.push(walk(item, baseDir, chain, depth, collect));
      }
    }
    return out;
  }

  if (node && typeof node === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (node);

    const rel =
      typeof obj.include === 'string' || isKeyRef(obj.include)
        ? includeTarget(obj.include, collect)
        : null;

    if (rel !== null) {
      const { content, pulled } = loadIncludeContent(rel, baseDir, chain, depth, collect);
      const rest = { ...obj };
      delete rest.include;
      const restResolved = /** @type {Record<string, unknown>} */ (
        walk(rest, baseDir, chain, depth, collect)
      );

      // Element pull (anonymous position — an array item or the root):
      // the pulled element takes this position under its own tag
      if (pulled) {
        return { [pulled.tag]: mergeIncludeMap(restResolved, pulled.body) };
      }
      // List partial → becomes children of the including node
      if (Array.isArray(content)) {
        const existing = Array.isArray(restResolved.children)
          ? restResolved.children
          : [];
        return { ...restResolved, children: [...content, ...existing] };
      }
      // Map partial → fill keys the local node doesn't define
      if (content && typeof content === 'object') {
        return mergeIncludeMap(restResolved, /** @type {Record<string, unknown>} */ (content));
      }
      // Scalar partial → text of the including node
      return { ...restResolved, text: String(content ?? '') };
    }

    const out = /** @type {Record<string, unknown>} */ ({});
    for (const [k, v] of Object.entries(obj)) {
      const fragmentRel = fragmentIncludeTarget(v, collect);
      if (fragmentRel !== null) {
        // Element-level include in a named position: the pulled element
        // keeps its own tag, replacing the including key — the key only
        // positions the pull (and carries the overriding local keys)
        const { pulled } = loadIncludeContent(fragmentRel, baseDir, chain, depth, collect);
        const el = /** @type {{ tag: string, body: Record<string, unknown> }} */ (pulled);
        const rest = { .../** @type {Record<string, unknown>} */ (v) };
        delete rest.include;
        const restResolved = /** @type {Record<string, unknown>} */ (
          walk(rest, baseDir, chain, depth, collect)
        );
        out[el.tag] = mergeIncludeMap(restResolved, el.body);
      } else {
        out[k] = walk(v, baseDir, chain, depth, collect);
      }
    }
    return out;
  }

  return node;
}

function isIncludeOnly(item) {
  return (
    isPlainObject(item) &&
    (typeof item.include === 'string' || isKeyRef(item.include)) &&
    Object.keys(item).length === 1
  );
}

/**
 * @param {unknown} include string path or { key: name }
 * @param {{ keys: Record<string, unknown> }} collect
 * @returns {string}
 */
function includeTarget(include, collect) {
  if (typeof include === 'string') return include;
  return includePathFromKey(/** @type {{ key: string }} */ (include).key, collect.keys);
}

/**
 * If value is an include node whose target carries an #id fragment, return
 * the resolved include target string; otherwise null. Key references are
 * resolved first, so a keys-declared path carrying #id works (conkeyref).
 * @param {unknown} v
 * @param {{ keys: Record<string, unknown> }} collect
 * @returns {string | null}
 */
function fragmentIncludeTarget(v, collect) {
  if (!isPlainObject(v)) return null;
  if (typeof v.include !== 'string' && !isKeyRef(v.include)) return null;
  const rel = includeTarget(v.include, collect);
  return splitFragment(rel).id === undefined ? null : rel;
}

/**
 * Split an include target into file path and optional element id:
 * `file.yml#copyright` → { file: "file.yml", id: "copyright" }.
 * An empty fragment (`file.yml#`) or a fragment with no file (`#id`) is a
 * structural include error — it throws in both modes, like an unresolvable
 * path or an undefined include key.
 * @param {string} rel
 * @returns {{ file: string, id: string | undefined }}
 */
function splitFragment(rel) {
  const hash = rel.indexOf('#');
  if (hash === -1) return { file: rel, id: undefined };
  const file = rel.slice(0, hash);
  const id = rel.slice(hash + 1);
  if (file === '') {
    throw new Error(
      `include "${rel}" has no file path — element-level includes address one element in another file: "file.yml#id"`,
    );
  }
  if (id === '') {
    throw new Error(
      `include "${rel}" has an empty fragment — use "${file}" for the whole file or "${file}#id" for one element`,
    );
  }
  return { file, id };
}

/**
 * Load an include target (path or key-resolved path, optionally carrying
 * #id) and return its content. Without a fragment the content is the whole
 * resolved partial, as today. With a fragment the content is the single
 * addressed element as a one-key map, and `pulled` exposes its tag and body
 * for callers that place the element under its own tag.
 * @param {string} rel
 * @param {string | undefined} baseDir
 * @param {string[]} chain
 * @param {number} depth
 * @param {{ keys: Record<string, unknown>, conventions: Record<string, unknown> }} collect
 * @returns {{ content: unknown, pulled: { tag: string, body: Record<string, unknown> } | undefined }}
 */
function loadIncludeContent(rel, baseDir, chain, depth, collect) {
  const { file, id } = splitFragment(rel);
  const resolved = loadResolved(file, baseDir, chain, depth, collect);
  if (id === undefined) return { content: resolved, pulled: undefined };
  const pulled = selectElementById(resolved, id, rel, file);
  return { content: { [pulled.tag]: pulled.body }, pulled };
}

/**
 * Find the element whose `id:` attribute equals the fragment inside a
 * resolved partial tree. Depth-first, document order; first match wins.
 * ld:/ld_if/@-prefixed subtrees are skipped — an id there is graph data,
 * not an element attribute. Unknown ids throw structurally, naming the
 * file, the id, and the ids the partial declares.
 * @param {unknown} tree resolved partial (nested includes already processed)
 * @param {string} id
 * @param {string} rel original include target (for the error message)
 * @param {string} file file portion of the target (for the error message)
 * @returns {{ tag: string, body: Record<string, unknown> }}
 */
function selectElementById(tree, id, rel, file) {
  /** @type {{ element?: { tag: string, body: Record<string, unknown> }, ids: string[] }} */
  const found = { element: undefined, ids: [] };
  collectById(tree, id, found);
  if (found.element) return found.element;
  const available = [...new Set(found.ids)];
  throw new Error(
    `include #id not found: "${id}" in ${file} (from "${rel}")` +
      (available.length
        ? ` — available ids: ${available.join(', ')}`
        : ' — the partial declares no id: attributes'),
  );
}

/**
 * @param {unknown} node
 * @param {string} id
 * @param {{ element?: { tag: string, body: Record<string, unknown> }, ids: string[] }} found
 */
function collectById(node, id, found) {
  if (Array.isArray(node)) {
    for (const item of node) collectById(item, id, found);
    return;
  }
  if (!isPlainObject(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'ld' || k === 'ld_if' || k.startsWith('@')) continue;
    if (isPlainObject(v) && v.id !== undefined && v.id !== null) {
      const vid = String(v.id);
      found.ids.push(vid);
      if (vid === id && found.element === undefined) {
        found.element = { tag: k, body: v };
      }
    }
    collectById(v, id, found);
  }
}

/**
 * Merge a resolved include body into the including node's local keys.
 * Local keys win and keep their document position; the include fills only
 * keys the local node doesn't define. `class` is the one exception: author
 * classes from both sides union (deduped, include classes first), so an
 * override never silently drops the pulled content's own classes.
 * @param {Record<string, unknown>} local including node's resolved keys
 * @param {Record<string, unknown>} inc include-side keys
 * @returns {Record<string, unknown>}
 */
function mergeIncludeMap(local, inc) {
  for (const [k, v] of Object.entries(inc)) {
    if (k === 'class' && local.class !== undefined && local.class !== null) {
      local.class = mergeClassValues(v, local.class);
    } else if (!(k in local)) {
      local[k] = v;
    }
  }
  return local;
}

/**
 * @param {unknown} base include-side classes (lead)
 * @param {unknown} extra local classes (merged in)
 * @returns {string}
 */
function mergeClassValues(base, extra) {
  const parts = `${base ?? ''} ${extra ?? ''}`.split(/\s+/).filter(Boolean);
  return [...new Set(parts)].join(' ');
}

function loadResolved(rel, baseDir, chain, depth, collect) {
  if (!baseDir) {
    throw new Error(
      `include "${rel}" needs a base directory — render from a file (CLI) or pass { baseDir }`,
    );
  }
  const filePath = path.resolve(baseDir, rel);
  if (chain.includes(filePath)) {
    throw new Error(
      `include cycle: ${[...chain, filePath].join(' → ')}`,
    );
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`include not found: ${rel} (resolved: ${filePath})`);
  }
  const parsed = yaml.load(preprocessYaml(fs.readFileSync(filePath, 'utf8')));
  if (parsed === null || parsed === undefined) return {};
  const harvested = harvestFileRoot(parsed, collect);
  return walk(harvested, path.dirname(filePath), [...chain, filePath], depth + 1, collect);
}
