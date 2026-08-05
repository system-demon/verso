/**
 * Twinseed context leaf — project a seed into an LLM-ready knowledge pack.
 *
 * Same source of truth as HTML + JSON-LD + Atom: render the graph, invert
 * relations, and emit a structured pack plus a pasteable markdown prompt.
 * Technical-docs / Semantic Web framing — not a product catalog dump.
 */

import { getBacklinks } from './feed.js';
import { renderYaml } from './yamlDom.js';

const CHANNEL_SKIP = new Set([
  'CollectionPage',
  'ItemList',
  'WebSite',
  'Organization',
  'Person',
  'WebPage',
]);

/**
 * @typedef {object} ContextEntity
 * @property {string} [id]
 * @property {string|string[]} [type]
 * @property {string} [name]
 * @property {string} [description]
 * @property {Record<string, unknown>} [props]
 * @property {string[]} [related]
 */

/**
 * Build an LLM context pack from a Twinseed seed.
 * @param {string} yamlSource
 * @param {{
 *   params?: Record<string, unknown>,
 *   baseDir?: string,
 *   strict?: boolean,
 *   profile?: Record<string, unknown> | string[],
 *   id?: string,
 *   title?: string,
 * }} [options]
 */
export function renderContext(yamlSource, options = {}) {
  const result = renderYaml(yamlSource, options);
  const links = getBacklinks(yamlSource, options);
  const relatedByKey = links.relatedByKey ?? {};

  const title =
    (typeof options.title === 'string' && options.title.trim()) ||
    pickTitle(result.ldJson) ||
    'Twinseed knowledge context';

  const summary = pickSummary(result.ldJson);
  const entities = extractEntities(result.ldJson, relatedByKey);
  const focus = options.id ? normalizeId(options.id) : undefined;
  const focused = focus
    ? entities.filter((e) => normalizeId(e.id) === focus || (relatedByKey[focus] ?? []).includes(normalizeId(e.id)))
    : entities;

  const pack = {
    format: 'twinseed.context.v1',
    title,
    ...(summary ? { summary } : {}),
    ...(focus ? { focus } : {}),
    entities: focused.length ? focused : entities,
    relations: focus
      ? { [focus]: relatedByKey[focus] ?? [] }
      : relatedByKey,
    ...(links.sections ? { sections: links.sections } : {}),
  };

  pack.prompt = buildPrompt(pack);
  return pack;
}

/**
 * @param {Record<string, unknown>} ldJson
 */
function pickTitle(ldJson) {
  return (
    asString(ldJson.name) ||
    asString(ldJson.headline) ||
    asString(ldJson['@name']) ||
    undefined
  );
}

/**
 * @param {Record<string, unknown>} ldJson
 */
function pickSummary(ldJson) {
  return asString(ldJson.description) || asString(ldJson.abstract) || undefined;
}

/**
 * @param {Record<string, unknown>} ldJson
 * @param {Record<string, string[]>} relatedByKey
 * @returns {ContextEntity[]}
 */
function extractEntities(ldJson, relatedByKey) {
  const graph = Array.isArray(ldJson['@graph'])
    ? ldJson['@graph'].filter((n) => n && typeof n === 'object')
    : [];

  /** @type {ContextEntity[]} */
  const entities = [];

  const pushNode = (node) => {
    if (!node || typeof node !== 'object') return;
    const types = asTypeList(node['@type']);
    if (types.length && types.every((t) => CHANNEL_SKIP.has(t))) {
      // Still keep WebPage-like roots if they carry useful description and no graph
      if (graph.length > 0) return;
    }
    const id = asString(node['@id']);
    const name =
      asString(node.name) ||
      asString(node.headline) ||
      asString(node.title) ||
      undefined;
    const description =
      asString(node.description) ||
      asString(node.abstract) ||
      asString(node.text) ||
      undefined;

    /** @type {Record<string, unknown>} */
    const props = {};
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('@')) continue;
      if (['name', 'headline', 'title', 'description', 'abstract', 'text'].includes(k)) continue;
      props[k] = simplifyValue(v);
    }

    const key = id ? normalizeId(id) : name ? slug(name) : undefined;
    const related = key ? relatedByKey[key] ?? [] : [];

    if (!name && !description && !id && !Object.keys(props).length) return;

    entities.push({
      ...(id ? { id } : {}),
      ...(types.length ? { type: types.length === 1 ? types[0] : types } : {}),
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(Object.keys(props).length ? { props } : {}),
      ...(related.length ? { related } : {}),
    });
  };

  for (const node of graph) pushNode(node);

  if (entities.length === 0) {
    const { '@graph': _g, ...root } = ldJson;
    pushNode(root);
  }

  return entities;
}

/**
 * @param {{
 *   title: string,
 *   summary?: string,
 *   focus?: string,
 *   entities: ContextEntity[],
 *   relations: Record<string, string[]>,
 *   sections?: Array<{ key: string, navText: string }>,
 * }} pack
 */
function buildPrompt(pack) {
  const lines = [];
  lines.push(`# ${pack.title}`);
  lines.push('');
  lines.push(
    'You are answering questions from a Twinseed knowledge seed (YAML → HTML + JSON-LD).',
  );
  lines.push('Prefer these entities and relations over prior knowledge when they conflict.');
  lines.push('');

  if (pack.summary) {
    lines.push('## Summary');
    lines.push(pack.summary);
    lines.push('');
  }

  if (pack.focus) {
    lines.push(`## Focus`);
    lines.push(`Primary concept: \`${pack.focus}\``);
    lines.push('');
  }

  if (pack.sections?.length) {
    lines.push('## Sections');
    for (const s of pack.sections) {
      lines.push(`- ${s.navText || s.key} (\`${s.key}\`)`);
    }
    lines.push('');
  }

  lines.push('## Entities');
  if (!pack.entities.length) {
    lines.push('(none)');
  } else {
    for (const e of pack.entities) {
      const type = Array.isArray(e.type) ? e.type.join(', ') : e.type;
      const head = [e.name || e.id || 'entity', type ? `(${type})` : '']
        .filter(Boolean)
        .join(' ');
      lines.push(`### ${head}`);
      if (e.id) lines.push(`- id: \`${e.id}\``);
      if (e.description) lines.push(`- description: ${e.description}`);
      if (e.related?.length) lines.push(`- related: ${e.related.map((r) => `\`${r}\``).join(', ')}`);
      if (e.props) {
        for (const [k, v] of Object.entries(e.props)) {
          lines.push(`- ${k}: ${formatProp(v)}`);
        }
      }
      lines.push('');
    }
  }

  const relKeys = Object.keys(pack.relations || {});
  if (relKeys.length) {
    lines.push('## Relations');
    for (const k of relKeys.sort()) {
      const others = pack.relations[k] ?? [];
      lines.push(`- \`${k}\` ↔ ${others.length ? others.map((o) => `\`${o}\``).join(', ') : '(none)'}`);
    }
    lines.push('');
  }

  lines.push('## Instructions');
  lines.push('- Cite entity ids / names when asserting facts from this pack.');
  lines.push('- If the pack does not contain the answer, say so rather than inventing.');
  lines.push('');

  return lines.join('\n');
}

/**
 * @param {unknown} v
 */
function simplifyValue(v) {
  if (v == null) return v;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(simplifyValue);
  if (typeof v === 'object') {
    const id = /** @type {Record<string, unknown>} */ (v)['@id'];
    if (typeof id === 'string' && Object.keys(v).length <= 2) return { '@id': id };
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === '@context') continue;
      out[k] = simplifyValue(val);
    }
    return out;
  }
  return String(v);
}

/**
 * @param {unknown} v
 */
function formatProp(v) {
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * @param {unknown} v
 */
function asString(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * @param {unknown} t
 * @returns {string[]}
 */
function asTypeList(t) {
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x) => typeof x === 'string');
  return [];
}

/**
 * @param {string} [id]
 */
function normalizeId(id) {
  if (!id) return '';
  return id.replace(/^#/, '').replace(/^twinseed:local#/, '');
}

/**
 * @param {string} s
 */
function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}
