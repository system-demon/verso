/**
 * Twinseed feed leaf — project a seed's JSON-LD graph into Atom / RSS.
 *
 * Same source of truth as HTML + JSON-LD: render first, then serialize
 * knowledge-shaped graph nodes (TechArticle, DefinedTerm, HowTo, …) as
 * syndication entries. Not a storefront catalog.
 */

import yaml from 'js-yaml';
import { isMapDocument, resolveMapTree } from './map.js';
import { preprocessYaml, renderYaml } from './yamlDom.js';

/** @type {Set<string>} */
const FEED_ITEM_TYPES = new Set([
  'TechArticle',
  'DefinedTerm',
  'Article',
  'CreativeWork',
  'HowTo',
  'HowToStep',
  'SoftwareSourceCode',
  'APIReference',
  'Dataset',
  'ScholarlyArticle',
  'WebPage',
]);

/** Publication / scaffolding types that are channel metadata, not entries. */
const CHANNEL_TYPES = new Set([
  'CollectionPage',
  'ItemList',
  'WebSite',
  'Organization',
  'Person',
]);

/**
 * @typedef {object} FeedItem
 * @property {string} id
 * @property {string} title
 * @property {string} [summary]
 * @property {string} [updated]
 * @property {string} [published]
 * @property {string} [link]
 * @property {string[]} [types]
 * @property {Array<{ href: string, title?: string, rel?: string }>} [links]
 */

/**
 * @typedef {object} FeedChannel
 * @property {string} title
 * @property {string} id
 * @property {string} [subtitle]
 * @property {string} [updated]
 * @property {string} [link]
 * @property {string} [selfHref]
 * @property {string} [author]
 */

/**
 * Render YAML and project the graph into Atom and/or RSS.
 * @param {string} yamlSource
 * @param {{
 *   params?: Record<string, unknown>,
 *   baseDir?: string,
 *   strict?: boolean,
 *   profile?: Record<string, unknown> | string[],
 *   format?: 'atom' | 'rss' | 'json',
 *   selfHref?: string,
 *   feedLink?: string,
 *   title?: string,
 * }} [options]
 */
export function renderFeed(yamlSource, options = {}) {
  const result = renderYaml(yamlSource, options);
  const built = buildFeedFromLd(result.ldJson, {
    selfHref: options.selfHref,
    feedLink: options.feedLink,
    title: options.title,
  });

  const format = options.format ?? 'atom';
  /** @type {Record<string, unknown>} */
  const out = {
    channel: built.channel,
    items: built.items,
    ldJson: result.ldJson,
    html: result.html,
    contentMap: result.contentMap,
  };
  if (format === 'atom' || format === 'json') out.atom = toAtomXml(built.channel, built.items);
  if (format === 'rss' || format === 'json') out.rss = toRssXml(built.channel, built.items);
  if (format === 'atom') out.xml = out.atom;
  else if (format === 'rss') out.xml = out.rss;
  return out;
}

/**
 * Build channel + items from a Twinseed JSON-LD document.
 * @param {Record<string, unknown>} ldJson
 * @param {{ selfHref?: string, feedLink?: string, title?: string, updated?: string }} [options]
 */
export function buildFeedFromLd(ldJson, options = {}) {
  const graph = Array.isArray(ldJson['@graph'])
    ? ldJson['@graph'].filter((n) => n && typeof n === 'object')
    : [];

  const channel = buildChannel(ldJson, graph, options);
  const items = extractFeedItems(ldJson, graph);

  if (!channel.updated && items.length) {
    channel.updated = items
      .map((i) => i.updated || i.published)
      .filter(Boolean)
      .sort()
      .at(-1);
  }
  if (!channel.updated) channel.updated = new Date().toISOString();

  return { channel, items };
}

/**
 * @param {Record<string, unknown>} ldJson
 * @param {Record<string, unknown>[]} graph
 * @param {{ selfHref?: string, feedLink?: string, title?: string, updated?: string }} options
 * @returns {FeedChannel}
 */
function buildChannel(ldJson, graph, options) {
  const rootTitle =
    asString(options.title) ||
    asString(ldJson.name) ||
    asString(ldJson.headline) ||
    asString(ldJson['@name']) ||
    'Twinseed knowledge feed';

  const rootId =
    asString(ldJson['@id']) ||
    asString(options.selfHref) ||
    asString(options.feedLink) ||
    `twinseed:feed:${slug(rootTitle)}`;

  const subtitle =
    asString(ldJson.description) ||
    asString(ldJson.abstract) ||
    undefined;

  return {
    title: rootTitle,
    id: absoluteId(rootId),
    subtitle,
    updated: asString(options.updated) || asString(ldJson.dateModified) || asString(ldJson.datePublished),
    link: asString(options.feedLink) || asString(ldJson.url) || undefined,
    selfHref: asString(options.selfHref) || undefined,
    author: pickAuthor(ldJson),
  };
}

/**
 * Prefer typed knowledge nodes; fall back to non-channel graph nodes with a title.
 * @param {Record<string, unknown>} ldJson
 * @param {Record<string, unknown>[]} graph
 * @returns {FeedItem[]}
 */
export function extractFeedItems(ldJson, graph) {
  /** @type {FeedItem[]} */
  const items = [];
  const hasPartOrder = orderFromHasPart(ldJson.hasPart);

  for (const node of graph) {
    const item = nodeToFeedItem(node);
    if (item) items.push(item);
  }

  // Standalone (non-map) documents may put the entity on the root
  if (items.length === 0 && looksLikeFeedEntity(ldJson)) {
    const rootItem = nodeToFeedItem({ ...ldJson, '@graph': undefined });
    if (rootItem) items.push(rootItem);
  }

  items.sort((a, b) => {
    const ai = hasPartOrder.get(a.id);
    const bi = hasPartOrder.get(b.id);
    if (ai !== undefined || bi !== undefined) {
      return (ai ?? 1e9) - (bi ?? 1e9);
    }
    const ad = a.updated || a.published || '';
    const bd = b.updated || b.published || '';
    if (ad !== bd) return bd.localeCompare(ad);
    return a.title.localeCompare(b.title);
  });

  return items;
}

/**
 * @param {unknown} hasPart
 * @returns {Map<string, number>}
 */
function orderFromHasPart(hasPart) {
  const map = new Map();
  if (!Array.isArray(hasPart)) return map;
  hasPart.forEach((part, i) => {
    if (part && typeof part === 'object' && typeof part['@id'] === 'string') {
      map.set(absoluteId(part['@id']), i);
    } else if (typeof part === 'string') {
      map.set(absoluteId(part), i);
    }
  });
  return map;
}

/**
 * @param {Record<string, unknown>} node
 * @returns {FeedItem | null}
 */
function nodeToFeedItem(node) {
  if (!node || typeof node !== 'object') return null;
  const types = asTypeList(node['@type']);
  if (types.some((t) => CHANNEL_TYPES.has(t)) && !types.some((t) => FEED_ITEM_TYPES.has(t))) {
    return null;
  }

  // DefinedTerm / HowTo prefer name; articles prefer headline
  const title = types.includes('DefinedTerm') || types.includes('HowTo')
    ? asString(node.name) || asString(node.headline) || asString(node.title) || null
    : asString(node.headline) || asString(node.name) || asString(node.title) || null;
  if (!title) return null;

  const typed = types.some((t) => FEED_ITEM_TYPES.has(t));
  const dated = Boolean(asString(node.datePublished) || asString(node.dateModified));
  // Skip bare section scaffolds (only @id + isRelatedTo) unless typed/dated
  if (!typed && !dated) {
    const keys = Object.keys(node).filter((k) => k !== '@id' && k !== '@context');
    if (keys.length <= 1 && (keys[0] === 'isRelatedTo' || keys.length === 0)) {
      return null;
    }
    // untitled structural leftovers without knowledge types stay out
    if (!types.length) return null;
  }

  const id = absoluteId(asString(node['@id']) || `twinseed:entry:${slug(title)}`);
  const summary = asString(node.description) || asString(node.abstract) || undefined;
  const published = asString(node.datePublished) || undefined;
  const updated = asString(node.dateModified) || published || undefined;
  const link = asString(node.url) || (id.startsWith('#') ? id : id.startsWith('http') ? id : undefined);

  /** @type {Array<{ href: string, title?: string, rel?: string }>} */
  const links = [];
  if (link) links.push({ href: link, rel: 'alternate' });
  pushIdLinks(links, node.isRelatedTo, 'related');
  pushIdLinks(links, node.mentions, 'related');
  pushIdLinks(links, node.isBasedOn, 'via');
  pushIdLinks(links, node.about, 'related');

  return {
    id,
    title,
    summary,
    updated,
    published,
    link,
    types: types.length ? types : undefined,
    links: links.length ? links : undefined,
  };
}

/**
 * @param {Record<string, unknown>} node
 */
function looksLikeFeedEntity(node) {
  const types = asTypeList(node['@type']);
  return (
    types.some((t) => FEED_ITEM_TYPES.has(t)) ||
    Boolean(asString(node.headline) || asString(node.name))
  );
}

/**
 * Invert map.relations (and JSON-LD isRelatedTo) into adjacency + backlinks.
 * Cheap: maps use resolveMapTree; any seed also contributes graph edges.
 * @param {string} yamlSource
 * @param {{ baseDir?: string, strict?: boolean, profile?: Record<string, unknown> | string[], id?: string }} [options]
 */
export function getBacklinks(yamlSource, options = {}) {
  const raw = yaml.load(preprocessYaml(yamlSource));
  if (!raw || typeof raw !== 'object') {
    throw new Error('seed root must be a mapping');
  }

  /** @type {Map<string, Set<string>>} */
  const relatedByKey = new Map();

  const addEdge = (a, b) => {
    if (!a || !b || a === b) return;
    const ak = normalizeRef(a);
    const bk = normalizeRef(b);
    if (!relatedByKey.has(ak)) relatedByKey.set(ak, new Set());
    if (!relatedByKey.has(bk)) relatedByKey.set(bk, new Set());
    relatedByKey.get(ak).add(bk);
    relatedByKey.get(bk).add(ak);
  };

  /** @type {Array<{ key: string, navText: string }> | undefined} */
  let sections;
  if (isMapDocument(raw)) {
    const { model } = resolveMapTree(raw, options);
    sections = model.sections.map((s) => ({ key: s.key, navText: s.navText }));
    for (const [a, b] of model.relations ?? []) addEdge(a, b);
    for (const s of model.sections ?? []) {
      if (!relatedByKey.has(s.key)) relatedByKey.set(s.key, new Set());
    }
  }

  const result = renderYaml(yamlSource, options);
  const graph = Array.isArray(result.ldJson['@graph']) ? result.ldJson['@graph'] : [];
  for (const node of graph) {
    if (!node || typeof node !== 'object') continue;
    const from = node['@id'];
    if (typeof from !== 'string') continue;
    for (const pred of ['isRelatedTo', 'mentions', 'about', 'isBasedOn', 'isPartOf']) {
      const targets = node[pred];
      const list = Array.isArray(targets) ? targets : targets ? [targets] : [];
      for (const t of list) {
        const id = typeof t === 'string' ? t : t && typeof t === 'object' ? t['@id'] : null;
        if (typeof id === 'string') addEdge(from, id);
      }
    }
  }

  /** @type {Record<string, string[]>} */
  const related = {};
  for (const [k, set] of relatedByKey) {
    related[k] = [...set].sort();
  }

  const focus = options.id ? normalizeRef(options.id) : undefined;
  return {
    relatedByKey: related,
    backlinks: focus
      ? { id: focus, related: related[focus] ?? [] }
      : related,
    sections,
  };
}

/**
 * @param {FeedChannel} channel
 * @param {FeedItem[]} items
 */
export function toAtomXml(channel, items) {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${esc(channel.title)}</title>`,
  ];
  if (channel.subtitle) lines.push(`  <subtitle>${esc(channel.subtitle)}</subtitle>`);
  lines.push(`  <id>${esc(channel.id)}</id>`);
  lines.push(`  <updated>${esc(channel.updated || new Date().toISOString())}</updated>`);
  if (channel.selfHref) {
    lines.push(`  <link rel="self" type="application/atom+xml" href="${esc(channel.selfHref)}"/>`);
  }
  if (channel.link) {
    lines.push(`  <link rel="alternate" href="${esc(channel.link)}"/>`);
  }
  if (channel.author) {
    lines.push('  <author>', `    <name>${esc(channel.author)}</name>`, '  </author>');
  }
  lines.push('  <generator uri="https://github.com/system-demon/twinseed">Twinseed</generator>');

  for (const item of items) {
    lines.push('  <entry>');
    lines.push(`    <title>${esc(item.title)}</title>`);
    lines.push(`    <id>${esc(item.id)}</id>`);
    const when = item.updated || item.published || channel.updated || new Date().toISOString();
    lines.push(`    <updated>${esc(when)}</updated>`);
    if (item.published) lines.push(`    <published>${esc(item.published)}</published>`);
    if (item.summary) lines.push(`    <summary>${esc(item.summary)}</summary>`);
    if (item.types?.length) {
      lines.push(
        `    <category term="${esc(item.types[0])}" scheme="https://schema.org/" label="${esc(item.types.join(', '))}"/>`,
      );
    }
    for (const l of item.links ?? []) {
      const rel = l.rel || 'related';
      const title = l.title ? ` title="${esc(l.title)}"` : '';
      lines.push(`    <link rel="${esc(rel)}" href="${esc(l.href)}"${title}/>`);
    }
    lines.push('  </entry>');
  }

  lines.push('</feed>');
  return `${lines.join('\n')}\n`;
}

/**
 * @param {FeedChannel} channel
 * @param {FeedItem[]} items
 */
export function toRssXml(channel, items) {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${esc(channel.title)}</title>`,
    `    <link>${esc(channel.link || channel.selfHref || channel.id)}</link>`,
    `    <description>${esc(channel.subtitle || channel.title)}</description>`,
    `    <lastBuildDate>${esc(toRfc822(channel.updated))}</lastBuildDate>`,
    '    <generator>Twinseed</generator>',
  ];

  for (const item of items) {
    lines.push('    <item>');
    lines.push(`      <title>${esc(item.title)}</title>`);
    lines.push(`      <guid isPermaLink="false">${esc(item.id)}</guid>`);
    if (item.link) lines.push(`      <link>${esc(item.link)}</link>`);
    if (item.summary) lines.push(`      <description>${esc(item.summary)}</description>`);
    const when = item.published || item.updated;
    if (when) lines.push(`      <pubDate>${esc(toRfc822(when))}</pubDate>`);
    if (item.types?.[0]) lines.push(`      <category>${esc(item.types[0])}</category>`);
    lines.push('    </item>');
  }

  lines.push('  </channel>', '</rss>');
  return `${lines.join('\n')}\n`;
}

/* ---------------------------------------------------------------- helpers */

/**
 * @param {Array<{ href: string, title?: string, rel?: string }>} links
 * @param {unknown} value
 * @param {string} rel
 */
function pushIdLinks(links, value, rel) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  for (const t of list) {
    const href = typeof t === 'string' ? t : t && typeof t === 'object' ? t['@id'] : null;
    if (typeof href === 'string') links.push({ href: absoluteId(href), rel });
  }
}

/** @param {unknown} v */
function asString(v) {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/** @param {unknown} t */
function asTypeList(t) {
  if (Array.isArray(t)) return t.filter((x) => typeof x === 'string');
  if (typeof t === 'string') return [t];
  return [];
}

/** @param {Record<string, unknown>} ld */
function pickAuthor(ld) {
  const a = ld.author;
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object' && typeof a.name === 'string') return a.name;
  return undefined;
}

/** @param {string} id */
function absoluteId(id) {
  if (id.startsWith('tag:') || id.startsWith('urn:') || id.startsWith('http://') || id.startsWith('https://')) {
    return id;
  }
  if (id.startsWith('#')) return `twinseed:local${id}`;
  if (id.startsWith('twinseed:')) return id;
  return id.includes(':') ? id : `twinseed:local:${id}`;
}

/** @param {string} ref */
function normalizeRef(ref) {
  const s = String(ref).trim();
  if (s.startsWith('twinseed:local#')) return s.slice('twinseed:local'.length);
  if (s.startsWith('#')) return s.slice(1);
  if (s.startsWith('twinseed:local:')) return s.slice('twinseed:local:'.length);
  return s;
}

/** @param {string} s */
function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'untitled';
}

/** @param {string} s */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** @param {string | undefined} iso */
function toRfc822(iso) {
  if (!iso) return new Date().toUTCString();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toUTCString();
}
