/**
 * Verso includes — inline another YAML tree via `include: "partial.yml"`
 * Paths resolve relative to the including file; cycles and runaway
 * depth fail fast with a readable chain. Runs before {{param}} injection
 * so placeholders inside partials are filled from the same params.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { preprocessYaml } from './yamlDom.js';

const MAX_DEPTH = 20;

/**
 * Resolve every `include:` key in a parsed YAML tree.
 * @param {unknown} node
 * @param {{ baseDir?: string, chain?: string[] }} [options]
 * @returns {unknown}
 */
export function resolveIncludes(node, options = {}) {
  return walk(node, options.baseDir, options.chain ?? [], 0);
}

function walk(node, baseDir, chain, depth) {
  if (depth > MAX_DEPTH) {
    throw new Error(
      `Verso include depth exceeded ${MAX_DEPTH}: ${chain.join(' → ')}`,
    );
  }

  if (Array.isArray(node)) {
    const out = [];
    for (const item of node) {
      if (isIncludeOnly(item)) {
        const inc = loadResolved(String(item.include), baseDir, chain, depth);
        if (Array.isArray(inc)) out.push(...inc);
        else out.push(inc);
      } else {
        out.push(walk(item, baseDir, chain, depth));
      }
    }
    return out;
  }

  if (node && typeof node === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (node);

    if (typeof obj.include === 'string') {
      const inc = loadResolved(obj.include, baseDir, chain, depth);
      const rest = { ...obj };
      delete rest.include;
      const restResolved = /** @type {Record<string, unknown>} */ (
        walk(rest, baseDir, chain, depth)
      );

      // List partial → becomes children of the including node
      if (Array.isArray(inc)) {
        const existing = Array.isArray(restResolved.children)
          ? restResolved.children
          : [];
        return { ...restResolved, children: [...inc, ...existing] };
      }
      // Map partial → fill keys the local node doesn't define; local keys
      // keep their position so document order stays intuitive
      if (inc && typeof inc === 'object') {
        for (const [k, v] of Object.entries(inc)) {
          if (!(k in restResolved)) restResolved[k] = v;
        }
        return restResolved;
      }
      // Scalar partial → text of the including node
      return { ...restResolved, text: String(inc ?? '') };
    }

    const out = /** @type {Record<string, unknown>} */ ({});
    for (const [k, v] of Object.entries(obj)) {
      out[k] = walk(v, baseDir, chain, depth);
    }
    return out;
  }

  return node;
}

function isIncludeOnly(item) {
  return (
    item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.include === 'string' &&
    Object.keys(item).length === 1
  );
}

function loadResolved(rel, baseDir, chain, depth) {
  if (!baseDir) {
    throw new Error(
      `Verso include "${rel}" needs a base directory — render from a file (CLI) or pass { baseDir }`,
    );
  }
  const filePath = path.resolve(baseDir, rel);
  if (chain.includes(filePath)) {
    throw new Error(
      `Verso include cycle: ${[...chain, filePath].join(' → ')}`,
    );
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Verso include not found: ${rel} (resolved: ${filePath})`);
  }
  const parsed = yaml.load(preprocessYaml(fs.readFileSync(filePath, 'utf8')));
  if (parsed === null || parsed === undefined) return {};
  return walk(parsed, path.dirname(filePath), [...chain, filePath], depth + 1);
}
