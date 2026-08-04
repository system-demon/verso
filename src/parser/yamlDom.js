/**
 * Verso core parser
 * Recursive YAML object → HTML (presentation) + ContentMap + JSON-LD (graph)
 */

import yaml from 'js-yaml';
import { ContentMap } from './contentMap.js';
import { buildLdDocument } from './ldResolver.js';
import { discoverImplicitSchemas } from './conventions.js';

const ATTR_KEYS = new Set([
  'id',
  'class',
  'href',
  'src',
  'alt',
  'type',
  'name',
  'value',
  'placeholder',
  'action',
  'method',
  'target',
  'rel',
  'role',
  'title',
  'width',
  'height',
  'for',
  'checked',
  'disabled',
  'readonly',
  'required',
  'colspan',
  'rowspan',
  'contenteditable',
]);

const TEXT_KEYS = new Set(['text', 'content', '_text']);

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const SPECIAL_SKIP = new Set(['ld', 'ld_if', '@context', '@type', '@name', '@id']);

let nodeCounter = 0;

/**
 * Replace {{var}} placeholders with params values.
 * @param {string} input
 * @param {Record<string, unknown>} params
 */
export function injectParams(input, params = {}) {
  return input.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (params[key] === undefined || params[key] === null) return '';
    return String(params[key]);
  });
}

/**
 * Deep-inject params into a parsed YAML structure (string leaves only).
 * @param {unknown} node
 * @param {Record<string, unknown>} params
 */
export function injectParamsDeep(node, params = {}) {
  if (typeof node === 'string') return injectParams(node, params);
  if (Array.isArray(node)) return node.map((n) => injectParamsDeep(n, params));
  if (node && typeof node === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = injectParamsDeep(v, params);
    }
    return out;
  }
  return node;
}

/**
 * Convert a style object or string to an inline style attribute value.
 * @param {unknown} style
 */
function styleToAttr(style) {
  if (typeof style === 'string') return style;
  if (!style || typeof style !== 'object') return '';
  return Object.entries(style)
    .map(([k, v]) => `${camelToKebab(k)}: ${v}`)
    .join('; ');
}

function camelToKebab(s) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/_/g, '-');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

/**
 * @typedef {object} RenderResult
 * @property {string} html
 * @property {object} ldJson
 * @property {Record<string, string>} contentMap
 * @property {string} [ldScript]
 */

/**
 * Quote bare @keys so js-yaml accepts JSON-LD style keys.
 * `@context: x` → `"@context": x`
 * @param {string} source
 */
export function preprocessYaml(source) {
  return source.replace(
    /^(\s*)@([A-Za-z_][\w]*):/gm,
    '$1"@$2":',
  );
}

/**
 * Parse YAML string and render to HTML + JSON-LD.
 * @param {string} yamlSource
 * @param {{ params?: Record<string, unknown> }} [options]
 * @returns {RenderResult}
 */
export function renderYaml(yamlSource, options = {}) {
  const raw = yaml.load(preprocessYaml(yamlSource));
  if (!raw || typeof raw !== 'object') {
    throw new Error('Verso root must be a mapping');
  }

  const tree = injectParamsDeep(raw, options.params ?? {});
  return renderTree(/** @type {Record<string, unknown>} */ (tree));
}

/**
 * Render an already-parsed YAML tree.
 * @param {Record<string, unknown>} tree
 * @returns {RenderResult}
 */
export function renderTree(tree) {
  nodeCounter = 0;
  const contentMap = new ContentMap();
  /** @type {{ root: Record<string, unknown>, blocks: object[], conditionals: object[] }} */
  const ldCollected = { root: {}, blocks: [], conditionals: [] };
  /** @type {Array<{ id?: string, classes: string[] }>} */
  const trackedElements = [];

  // Harvest root-level @* LD keys
  /** @type {Record<string, unknown>} */
  const visualRoot = {};
  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith('@')) {
      ldCollected.root[key] = value;
    } else {
      visualRoot[key] = value;
    }
  }

  const parts = [];
  for (const [key, value] of Object.entries(visualRoot)) {
    parts.push(
      renderNode(key, value, {
        contentMap,
        ldCollected,
        trackedElements,
        parentId: undefined,
        ancestorIds: [],
      }),
    );
  }

  const implicit = discoverImplicitSchemas(contentMap, trackedElements);
  const ldJson = buildLdDocument(ldCollected, contentMap, implicit);
  const html = parts.filter(Boolean).join('\n');
  const ldScript = `<script type="application/ld+json">${JSON.stringify(ldJson, null, 2)}</script>`;

  return {
    html,
    ldJson,
    contentMap: contentMap.toObject(),
    ldScript,
  };
}

/**
 * @param {string} tag
 * @param {unknown} value
 * @param {object} ctx
 * @returns {string}
 */
function renderNode(tag, value, ctx) {
  // Fragment: render children without wrapper
  if (tag === 'fragment' || tag === '_') {
    return renderChildren(value, ctx);
  }

  // Skip LD keys at this level (harvested by parent object walker)
  if (tag === 'ld' || tag === 'ld_if' || tag.startsWith('@')) {
    return '';
  }

  // String shorthand: h1: "Hello"
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return openClose(tag, {}, String(value), ctx);
  }

  // Array of children under a tag — e.g. li: [ ... ] means multiple items?
  // Spec: li: [ a, a ] → multiple <li>. For a list parent like ul with array value:
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          // Each item is a map of tag → content
          return Object.entries(item)
            .map(([k, v]) => renderNode(k, v, ctx))
            .join('');
        }
        return openClose(tag, {}, String(item ?? ''), ctx);
      })
      .join('\n');
  }

  if (!value || typeof value !== 'object') {
    return openClose(tag, {}, '', ctx);
  }

  const obj = /** @type {Record<string, unknown>} */ (value);

  // Harvest ld / ld_if on this element
  if (obj.ld && typeof obj.ld === 'object') {
    ctx.ldCollected.blocks.push(obj.ld);
  }
  if (obj.ld_if && typeof obj.ld_if === 'object') {
    ctx.ldCollected.conditionals.push(obj.ld_if);
  }

  // Collect attributes vs children
  /** @type {Record<string, string>} */
  const attrs = {};
  /** @type {Array<[string, unknown]>} */
  const children = [];
  let textContent = '';

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'ld' || k === 'ld_if' || k.startsWith('@')) continue;

    if (k === 'style') {
      const s = styleToAttr(v);
      if (s) attrs.style = s;
      continue;
    }

    if (TEXT_KEYS.has(k)) {
      textContent += String(v ?? '');
      continue;
    }

    if (ATTR_KEYS.has(k) || k.startsWith('data-') || k.startsWith('aria-')) {
      attrs[k] = String(v ?? '');
      continue;
    }

    // Ordered siblings when YAML can't repeat keys: children: [ { span: ... }, { span: ... } ]
    if ((k === 'children' || k === '$') && Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          for (const [ck, cv] of Object.entries(item)) {
            children.push([ck, cv]);
          }
        }
      }
      continue;
    }

    // Nested element
    children.push([k, v]);
  }

  const id = attrs.id;
  const classes = (attrs.class ?? '').split(/\s+/).filter(Boolean);
  const nodeId = id || `__n${++nodeCounter}`;

  if (id || classes.length) {
    ctx.trackedElements.push({ id, classes });
  }

  // Build child HTML with updated parent context
  const childCtx = {
    ...ctx,
    parentId: id || ctx.parentId,
    ancestorIds: id ? [...ctx.ancestorIds, id] : ctx.ancestorIds,
  };

  let inner = escapeHtml(textContent);
  for (const [childTag, childVal] of children) {
    inner += renderNode(childTag, childVal, childCtx);
  }

  // Register in content map (prefer explicit text, else concatenated child text later)
  const mapText =
    textContent ||
    (children.length === 0 ? '' : extractPlainText(children));

  ctx.contentMap.registerNode({
    nodeId,
    tag,
    id,
    classes,
    text: mapText || textContent,
    parentId: ctx.parentId,
  });

  // Also register scoped selectors for nested text fields onto nearest id ancestor
  const scopeId = id || ctx.parentId;
  if (scopeId && textContent) {
    ctx.contentMap.set(`#${scopeId} ${tag}`, textContent.trim());
    for (const cls of classes) {
      ctx.contentMap.set(`#${scopeId} .${cls}`, textContent.trim());
    }
  }

  return openClose(tag, attrs, inner, ctx, { rawInner: true });
}

/**
 * Rough plain text extraction from child entries for content map.
 * @param {Array<[string, unknown]>} children
 */
function extractPlainText(children) {
  const parts = [];
  for (const [, v] of children) {
    if (typeof v === 'string' || typeof v === 'number') parts.push(String(v));
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = /** @type {Record<string, unknown>} */ (v);
      if (o.text) parts.push(String(o.text));
    }
  }
  return parts.join(' ').trim();
}

/**
 * @param {unknown} value
 * @param {object} ctx
 */
function renderChildren(value, ctx) {
  if (typeof value === 'string') return escapeHtml(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          return Object.entries(item)
            .map(([k, v]) => renderNode(k, v, ctx))
            .join('');
        }
        return escapeHtml(String(item ?? ''));
      })
      .join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => renderNode(k, v, ctx))
      .join('\n');
  }
  return '';
}

/**
 * @param {string} tag
 * @param {Record<string, string>} attrs
 * @param {string} inner
 * @param {object} ctx
 * @param {{ rawInner?: boolean }} [opts]
 */
function openClose(tag, attrs, inner, ctx, opts = {}) {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');

  const id = attrs.id;
  const classes = (attrs.class ?? '').split(/\s+/).filter(Boolean);
  const nodeId = id || `__n${++nodeCounter}`;

  // Register leaf string nodes
  if (!opts.rawInner) {
    ctx.contentMap.registerNode({
      nodeId,
      tag,
      id,
      classes,
      text: inner,
      parentId: ctx.parentId,
    });
    if (id || classes.length) {
      ctx.trackedElements.push({ id, classes });
    }
    const scopeId = id || ctx.parentId;
    if (scopeId && inner) {
      ctx.contentMap.set(`#${scopeId} ${tag}`, String(inner).trim());
      for (const cls of classes) {
        ctx.contentMap.set(`#${scopeId} .${cls}`, String(inner).trim());
      }
    }
  }

  if (VOID_TAGS.has(tag.toLowerCase())) {
    return `<${tag}${attrStr}>`;
  }

  const body = opts.rawInner ? inner : escapeHtml(inner);
  return `<${tag}${attrStr}>${body}</${tag}>`;
}

/**
 * Wrap rendered body HTML into a full document with LD script in <head>.
 * @param {RenderResult} result
 * @param {{ title?: string }} [meta]
 */
export function toDocument(result, meta = {}) {
  const title = meta.title ?? 'Verso';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${result.ldScript}
</head>
${result.html.includes('<body') ? result.html : `<body>\n${result.html}\n</body>`}
</html>`;
}
