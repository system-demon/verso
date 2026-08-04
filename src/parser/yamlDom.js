/**
 * Verso core parser
 * Recursive YAML object → HTML (presentation) + ContentMap + JSON-LD (graph)
 */

import yaml from 'js-yaml';
import { ContentMap } from './contentMap.js';
import { buildLdDocument } from './ldResolver.js';
import { discoverImplicitSchemas, ConventionRegistry } from './conventions.js';
import { resolveIncludes } from './includes.js';
import { validateTree, strictFromEnv } from './validate.js';

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

/**
 * Standard HTML tags. Entity shorthand keys (product:, article:, …) that
 * match a real tag keep it; anything else expands to a <div>.
 */
const KNOWN_TAGS = new Set([
  'html', 'head', 'body', 'title', 'base', 'link', 'meta', 'style', 'script',
  'main', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'address',
  'div', 'span', 'p', 'a', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'form', 'input', 'button', 'label', 'select', 'optgroup', 'option', 'textarea',
  'fieldset', 'legend', 'datalist', 'output', 'progress', 'meter',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup',
  'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas', 'svg',
  'figure', 'figcaption', 'iframe', 'embed', 'object', 'param', 'portal',
  'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'code', 'pre',
  'blockquote', 'q', 'cite', 'abbr', 'time', 'data', 'mark', 'del', 'ins',
  'kbd', 'samp', 'var', 'dfn', 'ruby', 'rt', 'rp', 'bdi', 'bdo', 'wbr', 'br', 'hr',
  'details', 'summary', 'dialog', 'template', 'slot', 'map', 'area',
]);

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
 * @property {{ title?: string, html: string }} [head] parsed top-level head: block
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
 * @param {{ params?: Record<string, unknown>, baseDir?: string, strict?: boolean }} [options]
 *   baseDir enables `include: "file.yml"` resolution (relative to the source file).
 *   strict (or VERSO_STRICT=1) validates the resolved tree before rendering —
 *   pass strict: false to ignore the env var.
 * @returns {RenderResult}
 */
export function renderYaml(yamlSource, options = {}) {
  const raw = yaml.load(preprocessYaml(yamlSource));
  if (!raw || typeof raw !== 'object') {
    throw new Error('Verso root must be a mapping');
  }

  const withIncludes = resolveIncludes(raw, { baseDir: options.baseDir });
  if (options.strict ?? strictFromEnv()) {
    validateTree(withIncludes);
  }
  const tree = injectParamsDeep(withIncludes, options.params ?? {});
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
  /** @type {{ root: Record<string, unknown>, blocks: Array<{ block: object, graphId?: string }>, conditionals: Array<{ block: object, graphId?: string }> }} */
  const ldCollected = { root: {}, blocks: [], conditionals: [] };
  /** @type {Array<{ id?: string, classes: string[], graphId?: string }>} */
  const trackedElements = [];

  // Harvest root-level @* LD keys and the head: block
  /** @type {Record<string, unknown>} */
  const visualRoot = {};
  /** @type {{ title?: string, html: string } | undefined} */
  let head;
  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith('@')) {
      ldCollected.root[key] = value;
    } else if (key === 'head') {
      head = parseHeadBlock(value, {
        contentMap,
        ldCollected,
        trackedElements,
        parentId: undefined,
        ancestorIds: [],
      });
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
    head,
  };
}

/**
 * Parse a top-level head: block into a title + raw <head> inner HTML.
 *   head: "Title"                          → title only
 *   head:
 *     title: "..."
 *     meta:  { description: "..." } | [ { name: ..., content: ... } ]
 *     link:  { stylesheet: "a.css" } | [ { rel: ..., href: ... } ]
 *     css:   "raw css" | { selector: { prop: value } }   → <style>
 *     <anything else>                      → rendered as an element (script:, base:, …)
 * @param {unknown} value
 * @param {object} ctx
 */
function parseHeadBlock(value, ctx) {
  /** @type {{ title?: string, html: string }} */
  const head = { html: '' };
  if (typeof value === 'string') {
    head.title = value;
    return head;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return head;

  const parts = [];
  for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    if (k === 'title') {
      head.title = String(v ?? '');
    } else if (k === 'meta') {
      parts.push(renderHeadMeta(v));
    } else if (k === 'link') {
      parts.push(renderHeadLink(v));
    } else if (k === 'css' || k === 'style') {
      const css = typeof v === 'string' ? v : cssMapToCss(v);
      if (css.trim()) parts.push(`<style>\n${css}\n</style>`);
    } else {
      parts.push(renderNode(k, v, ctx));
    }
  }
  head.html = parts.filter(Boolean).join('\n');
  return head;
}

/**
 * meta: map of name→content, or a list of attribute maps.
 * @param {unknown} v
 */
function renderHeadMeta(v) {
  if (Array.isArray(v)) {
    return v
      .map((item) => (item && typeof item === 'object' ? attrsTag('meta', item) : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (v && typeof v === 'object') {
    return Object.entries(/** @type {Record<string, unknown>} */ (v))
      .map(([name, content]) =>
        name === 'charset'
          ? `<meta charset="${escapeAttr(content)}">`
          : `<meta name="${escapeAttr(name)}" content="${escapeAttr(content)}">`,
      )
      .join('\n');
  }
  return '';
}

/**
 * link: map of rel→href, a single attribute map ({ rel, href, … }), or a list of those.
 * @param {unknown} v
 */
function renderHeadLink(v) {
  if (Array.isArray(v)) {
    return v
      .map((item) => (item && typeof item === 'object' ? attrsTag('link', item) : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (v && typeof v === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (v);
    if ('rel' in obj && 'href' in obj) return attrsTag('link', obj);
    return Object.entries(obj)
      .map(([rel, href]) => `<link rel="${escapeAttr(rel)}" href="${escapeAttr(href)}">`)
      .join('\n');
  }
  return '';
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} attrs
 */
function attrsTag(tag, attrs) {
  const attrStr = Object.entries(attrs)
    .map(([k, val]) => ` ${k}="${escapeAttr(val)}"`)
    .join('');
  return `<${tag}${attrStr}>`;
}

/**
 * Selector → declarations map to plain CSS text (one level, no pipeline).
 * @param {unknown} map
 */
function cssMapToCss(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return '';
  return Object.entries(/** @type {Record<string, unknown>} */ (map))
    .map(([selector, decls]) => {
      if (typeof decls === 'string') return `${selector} { ${decls} }`;
      if (!decls || typeof decls !== 'object') return '';
      const body = Object.entries(/** @type {Record<string, unknown>} */ (decls))
        .map(([prop, val]) => `  ${camelToKebab(prop)}: ${val};`)
        .join('\n');
      return `${selector} {\n${body}\n}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Ensure the convention trigger class is present, keeping author classes.
 * @param {string} trigger
 * @param {unknown} existing
 */
function mergeClass(trigger, existing) {
  const parts = String(existing ?? '').split(/\s+/).filter(Boolean);
  if (!parts.includes(trigger)) parts.unshift(trigger);
  return parts.join(' ');
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

  // Entity shorthand: a key matching a registered convention (product:, article:, …)
  // becomes an element carrying that class, so implicit JSON-LD still fires.
  // Real HTML tags keep their tag (article: → <article class="article">),
  // anything else expands to a <div> (product: → <div class="product">).
  const key = tag.toLowerCase();
  const entityClass = ConventionRegistry[key] ? key : null;
  const outTag = entityClass && !KNOWN_TAGS.has(key) ? 'div' : tag;
  const entityAttrs = entityClass ? { class: entityClass } : {};

  // String shorthand: h1: "Hello"
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return openClose(outTag, entityAttrs, String(value), ctx);
  }

  // Array of children under a tag — e.g. li: [ ... ] means multiple items?
  // Spec: li: [ a, a ] → multiple <li>. For a list parent like ul with array value:
  if (Array.isArray(value)) {
    if (entityClass) {
      // product: [ {...}, {...} ] → one entity element per item
      return value
        .map((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const obj = /** @type {Record<string, unknown>} */ (item);
            return renderNode(outTag, { ...obj, class: mergeClass(entityClass, obj.class) }, ctx);
          }
          return openClose(outTag, entityAttrs, String(item ?? ''), ctx);
        })
        .join('\n');
    }
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
    return openClose(outTag, entityAttrs, '', ctx);
  }

  const obj = /** @type {Record<string, unknown>} */ (value);

  // Graph node id for this element: explicit @id wins, else the HTML id
  // attribute as a fragment IRI. Lets ld:, ld_if and conventions co-author
  // the same graph node.
  const elIdAttr =
    obj.id !== undefined && obj.id !== null ? String(obj.id) : undefined;
  const graphId =
    typeof obj['@id'] === 'string' && obj['@id']
      ? obj['@id']
      : elIdAttr
        ? `#${elIdAttr}`
        : undefined;

  // Harvest ld / ld_if on this element, tagged with its graph node id
  if (obj.ld && typeof obj.ld === 'object') {
    ctx.ldCollected.blocks.push({ block: obj.ld, graphId });
  }
  if (obj.ld_if && typeof obj.ld_if === 'object') {
    ctx.ldCollected.conditionals.push({ block: obj.ld_if, graphId });
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

  if (entityClass) attrs.class = mergeClass(entityClass, attrs.class);

  const id = attrs.id;
  const classes = (attrs.class ?? '').split(/\s+/).filter(Boolean);
  const nodeId = id || `__n${++nodeCounter}`;

  if (id || classes.length) {
    ctx.trackedElements.push({ id, classes, graphId });
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
    tag: outTag,
    id,
    classes,
    text: mapText || textContent,
    parentId: ctx.parentId,
  });

  // Also register scoped selectors for nested text fields onto nearest id ancestor
  const scopeId = id || ctx.parentId;
  if (scopeId && textContent) {
    ctx.contentMap.set(`#${scopeId} ${outTag}`, textContent.trim());
    for (const cls of classes) {
      ctx.contentMap.set(`#${scopeId} .${cls}`, textContent.trim());
    }
  }

  return openClose(outTag, attrs, inner, ctx, { rawInner: true });
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
 * A parsed head: block (result.head) supplies title/meta/link/style;
 * charset and viewport defaults are skipped when the block provides them.
 * @param {RenderResult} result
 * @param {{ title?: string }} [meta]
 */
export function toDocument(result, meta = {}) {
  const head = result.head;
  const title = head?.title ?? meta.title ?? 'Verso';
  const headHtml = head?.html ?? '';

  const lines = ['<!DOCTYPE html>', '<html lang="en">', '<head>'];
  if (!/charset/i.test(headHtml)) lines.push('  <meta charset="utf-8">');
  if (!/name="viewport"/i.test(headHtml)) {
    lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1">');
  }
  lines.push(`  <title>${escapeHtml(title)}</title>`);
  if (headHtml) lines.push(...headHtml.split('\n').map((l) => `  ${l}`));
  lines.push(`  ${result.ldScript}`, '</head>');
  lines.push(
    result.html.includes('<body') ? result.html : `<body>\n${result.html}\n</body>`,
    '</html>',
  );
  return lines.join('\n');
}
