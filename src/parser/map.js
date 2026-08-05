/**
 * Twinseed maps — `map:` composition documents (P1)
 *
 * A top-level `map:` key makes the file a composition document: it owns
 * publication STRUCTURE (order, nav, relations, pagination) while fragments —
 * ordinary Twinseed files pulled in through the existing include machinery —
 * own content. One structure, three projections: an HTML document, a nav
 * tree, and a site-level knowledge graph (CollectionPage + hasPart).
 *
 * Cascade rules (docs/dita-research.md open question 6):
 *   - map-level keys: / conventions: propagate into every fragment; the map
 *     wins name conflicts (first-definition-wins, like include chains)
 *   - the document @context merges with fragment-level contexts (deduped)
 *   - head: does NOT cascade — only the map's own head: reaches --doc output
 *
 * Rendering builds a synthetic tree — each item becomes a <section id="KEY">
 * wrapping its fragment — and runs the standard pipeline (includes → profile
 * filtering → strict validation → {{params}} → { key } → render), so cycle
 * protection, fragment-relative includes, conventions and @id merging behave
 * exactly as in standalone files. Profile filtering (P4) hooks in over the
 * assembled tree — the first point where fragment content exists — so
 * `if:`/`flag:` inside fragments is honored, and excluded sections never
 * render or assert into the graph.
 */

import {
  ConventionRegistry,
  buildRenderRegistry,
} from './conventions.js';
import { resolveIncludes } from './includes.js';
import { isKeyRef, resolveKeys } from './keys.js';
import {
  TwinseedValidationError,
  strictFromEnv,
  validateTree,
} from './validate.js';
import { filterTree, parseProfile } from './profiles.js';
import { injectParamsDeep, renderTree } from './yamlDom.js';

const isPlainObject = (v) =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const MAP_KEYS = new Set([
  'title',
  'ld',
  'head',
  'keys',
  'conventions',
  'items',
  'relations',
]);

/**
 * True when a parsed YAML root is a composition document.
 * @param {unknown} raw
 */
export function isMapDocument(raw) {
  return isPlainObject(raw) && 'map' in raw;
}

/**
 * Render a map document to HTML + JSON-LD.
 * @param {Record<string, unknown>} raw parsed YAML root carrying `map:`
 * @param {{ params?: Record<string, unknown>, baseDir?: string, strict?: boolean, item?: string, profile?: Record<string, unknown> | string[] }} [options]
 *   item: render only that section — html is the section's HTML and ldJson is
 *   filtered to the publication node plus that section's node (chunking).
 *   profile: profiling attributes for `if:`/`flag:` (see profiles.js); applied
 *   over the assembled tree right after includes resolve.
 * @returns {import('./yamlDom.js').RenderResult & { item?: string }}
 */
export function renderMap(raw, options = {}) {
  const resolved = resolveMapTree(raw, options);
  const result = renderTree(resolved.tree, {
    registry: resolved.registry,
    strict: resolved.strict,
    refKeyUsages: resolved.refKeyUsages,
    rootLd: resolved.rootLd,
  });

  const item = typeof options.item === 'string' ? options.item : undefined;
  if (item === undefined) return result;
  return extractItem(result, resolved.tree, resolved.model, resolved.registry, item);
}

/**
 * Run the map pipeline up to (but not including) renderTree: build the
 * render model, assemble the synthetic section/nav tree, resolve fragment
 * includes, then apply profile filtering, {{params}} injection and { key }
 * substitution — plus the publication-level root JSON-LD that renderTree
 * receives as a separate option. This is the map half of resolveTree()
 * (yamlDom.js): `tree` is the resolved intermediate `--emit resolved`
 * prints for `map:` documents.
 * @param {Record<string, unknown>} raw parsed YAML root carrying `map:`
 * @param {{ params?: Record<string, unknown>, baseDir?: string, strict?: boolean, profile?: Record<string, unknown> | string[] }} [options]
 *   profile: profiling attributes for `if:`/`flag:` (see profiles.js); applied
 *   over the assembled tree right after includes resolve.
 * @returns {{ tree: Record<string, unknown>, registry: Record<string, import('./conventions.js').ResolvedConvention>, refKeyUsages: Array<{ name: string, selector: string, path: string }>, rootLd: Record<string, unknown>, model: { sections: Array<{ key: string, navText: string }> }, strict: boolean }}
 */
export function resolveMapTree(raw, options = {}) {
  const strict = options.strict ?? strictFromEnv();
  const profile = parseProfile(options.profile);
  const model = buildMapModel(raw.map, { strict });

  // Seed the harvest collector with map-level declarations BEFORE fragments
  // load: first-definition-wins then makes the map win every name conflict,
  // and collect.contexts opts into fragment @context harvesting (+ head:
  // stripping) inside includes.js.
  const collect = {
    keys: isPlainObject(raw.map.keys) ? { ...raw.map.keys } : {},
    conventions: isPlainObject(raw.map.conventions)
      ? { ...raw.map.conventions }
      : {},
    contexts: [],
  };

  const synthetic = { fragment: [model.navNode, ...model.rootNodes] };
  const withIncludes = /** @type {Record<string, unknown>} */ (
    resolveIncludes(synthetic, { baseDir: options.baseDir, collect })
  );
  // Added post-resolution on purpose: fragment head: blocks are stripped
  // during harvesting; only the map's own head: survives.
  if (model.head !== undefined) withIncludes.head = model.head;

  // Profile filtering hooks over the assembled tree: fragment content only
  // exists post-include, and excluded sections must not reach the render or
  // the graph. (In standalone files filterTree runs pre-include instead —
  // see yamlDom.js — so gate includes with if:/flag: at the include site.)
  const filtered = filterTree(withIncludes, profile, { strict });

  const registry = buildRenderRegistry(ConventionRegistry, collect.conventions);
  if (strict) {
    validateTree(filtered, {
      registry,
      conventions: collect.conventions,
      keys: collect.keys,
    });
  }
  const tree = injectParamsDeep(filtered, options.params ?? {});
  const { tree: keyed, refKeyUsages } = resolveKeys(tree, collect.keys, {
    strict,
  });
  const rootLd = buildRootLd(raw, model, collect.contexts);
  return {
    tree: /** @type {Record<string, unknown>} */ (keyed),
    registry,
    refKeyUsages,
    rootLd,
    model,
    strict,
  };
}

/* ---------------------------------------------------------------- model */

/**
 * @typedef {object} MapItem
 * @property {string} key final unique section key
 * @property {string} navText link text for nav/related/pager
 * @property {unknown} [include] include target (path string or { key })
 * @property {MapItem[]} children nested items
 */

/**
 * Validate the map block and normalize it into a render model: unique keys,
 * nav text, a nav tree, section nodes with related-link and pager footers.
 * Structural problems (map not a mapping, items not a list) throw in both
 * modes — like include errors, they leave nothing sensible to render.
 * Item-level problems are strict errors with lenient fallbacks.
 * @param {unknown} map
 * @param {{ strict: boolean }} options
 */
function buildMapModel(map, options) {
  if (!isPlainObject(map)) {
    throw new TwinseedValidationError(
      'Twinseed "map" must be a mapping of { title, ld, head, keys, conventions, items, relations }',
      'map',
    );
  }
  if (map.items !== undefined && !Array.isArray(map.items)) {
    throw new TwinseedValidationError(
      '"items" must be a list of { key, include, nav, items }',
      'map.items',
    );
  }
  if (options.strict) validateMapBlock(map);

  /** @type {{ usedKeys: Set<string>, sections: Array<{ key: string, navText: string }> }} */
  const state = { usedKeys: new Set(), sections: [] };
  const items = normalizeItems(map.items ?? [], 'map.items', state, options);
  const relations = normalizeRelations(map.relations, state, options);

  /** @type {Map<string, string[]>} */
  const relatedByKey = new Map();
  for (const [a, b] of relations) {
    if (!relatedByKey.has(a)) relatedByKey.set(a, []);
    if (!relatedByKey.has(b)) relatedByKey.set(b, []);
    relatedByKey.get(a).push(b);
    relatedByKey.get(b).push(a);
  }
  /** @type {Map<string, { key: string, navText: string }>} */
  const sectionsByKey = new Map(state.sections.map((s) => [s.key, s]));

  const linkCtx = { relatedByKey, sectionsByKey };
  const rootNodes = items.map((item, i) => ({
    section: buildSectionNode(item, {
      ...linkCtx,
      prev: items[i - 1],
      next: items[i + 1],
    }),
  }));

  return {
    items,
    sections: state.sections,
    relations,
    ldBlock: isPlainObject(map.ld) ? map.ld : undefined,
    title: typeof map.title === 'string' ? map.title : undefined,
    head: map.head,
    navNode: items.length
      ? { nav: { children: [buildNavList(items)] } }
      : undefined,
    rootNodes,
  };
}

/**
 * Strict-only checks on the map block itself (item checks happen during
 * normalization, where path context is available).
 * @param {Record<string, unknown>} map
 */
function validateMapBlock(map) {
  for (const k of Object.keys(map)) {
    if (!MAP_KEYS.has(k)) {
      throw new TwinseedValidationError(
        `unknown map key "${k}" — maps support: ${[...MAP_KEYS].join(', ')}`,
        `map.${k}`,
      );
    }
  }
  if (map.ld !== undefined && !isPlainObject(map.ld)) {
    throw new TwinseedValidationError(
      '"ld" must be a mapping of JSON-LD properties — it describes the publication node',
      'map.ld',
    );
  }
  if (map.keys !== undefined && !isPlainObject(map.keys)) {
    throw new TwinseedValidationError(
      '"keys" must be a mapping — it cascades into every fragment',
      'map.keys',
    );
  }
  if (map.conventions !== undefined && !isPlainObject(map.conventions)) {
    throw new TwinseedValidationError(
      '"conventions" must be a mapping — it cascades into every fragment',
      'map.conventions',
    );
  }
  if (map.title !== undefined && typeof map.title !== 'string') {
    throw new TwinseedValidationError('"title" must be a string', 'map.title');
  }
}

/**
 * Normalize one level of the items tree. Pushes each item onto
 * state.sections in document order (parents before children) — that flat
 * list drives hasPart and the prev/next sequence.
 * @param {unknown[]} list
 * @param {string} path
 * @param {{ usedKeys: Set<string>, sections: Array<{ key: string, navText: string }> }} state
 * @param {{ strict: boolean }} options
 * @returns {MapItem[]}
 */
function normalizeItems(list, path, state, options) {
  /** @type {MapItem[]} */
  const out = [];
  list.forEach((rawItem, i) => {
    const ipath = `${path}[${i}]`;
    if (!isPlainObject(rawItem)) {
      if (options.strict) {
        throw new TwinseedValidationError(
          'map items must be mappings of { key, include, nav, items }',
          ipath,
        );
      }
      return;
    }

    let key = rawItem.key;
    if (key === undefined || key === null || key === '') {
      if (options.strict) {
        throw new TwinseedValidationError(
          'map item requires a "key" — sections are addressed by it (nav, relations, params.item)',
          `${ipath}.key`,
        );
      }
      key = `item-${state.sections.length + 1}`;
    } else if (typeof key !== 'string') {
      if (options.strict) {
        throw new TwinseedValidationError(
          '"key" must be a string',
          `${ipath}.key`,
        );
      }
      key = String(key);
    }
    if (state.usedKeys.has(key)) {
      if (options.strict) {
        throw new TwinseedValidationError(
          `duplicate map item key "${key}" — keys must be unique across the map`,
          `${ipath}.key`,
        );
      }
      let n = 2;
      while (state.usedKeys.has(`${key}-${n}`)) n += 1;
      key = `${key}-${n}`;
    }
    state.usedKeys.add(key);

    let navText = key;
    if (rawItem.nav !== undefined) {
      if (typeof rawItem.nav === 'string') navText = rawItem.nav;
      else if (options.strict) {
        throw new TwinseedValidationError('"nav" must be a string', `${ipath}.nav`);
      }
    }

    // Parents enter the flat section list before their children.
    state.sections.push({ key, navText });

    const include = rawItem.include;
    const hasInclude = typeof include === 'string' || isKeyRef(include);
    if (include !== undefined && !hasInclude && options.strict) {
      throw new TwinseedValidationError(
        '"include" must be a path string or a { key: name } reference',
        `${ipath}.include`,
      );
    }

    /** @type {MapItem[]} */
    let children = [];
    if (rawItem.items !== undefined) {
      if (!Array.isArray(rawItem.items)) {
        if (options.strict) {
          throw new TwinseedValidationError(
            '"items" must be a list of nested items',
            `${ipath}.items`,
          );
        }
      } else {
        children = normalizeItems(rawItem.items, `${ipath}.items`, state, options);
      }
    }

    if (!hasInclude && children.length === 0 && options.strict) {
      throw new TwinseedValidationError(
        'map item needs an "include" and/or nested "items" — an empty section publishes nothing',
        ipath,
      );
    }

    out.push({ key, navText, include: hasInclude ? include : undefined, children });
  });
  return out;
}

/**
 * Normalize relations to a list of [key, key] pairs, validating targets
 * against the keys collected while walking items (forward refs allowed).
 * @param {unknown} raw
 * @param {{ usedKeys: Set<string> }} state
 * @param {{ strict: boolean }} options
 * @returns {Array<[string, string]>}
 */
function normalizeRelations(raw, state, options) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    if (options.strict) {
      throw new TwinseedValidationError(
        '"relations" must be a list of [key, key] pairs',
        'map.relations',
      );
    }
    return [];
  }
  /** @type {Array<[string, string]>} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  raw.forEach((entry, i) => {
    const rpath = `map.relations[${i}]`;
    const pair =
      Array.isArray(entry) &&
      entry.length === 2 &&
      entry.every((k) => typeof k === 'string');
    if (!pair) {
      if (options.strict) {
        throw new TwinseedValidationError(
          'relations entries must be [key, key] pairs of item keys',
          rpath,
        );
      }
      return;
    }
    const [a, b] = /** @type {string[]} */ (entry);
    if (a === b) {
      if (options.strict) {
        throw new TwinseedValidationError(
          `relations pair "${a}" references the same key twice`,
          rpath,
        );
      }
      return;
    }
    for (const k of [a, b]) {
      if (!state.usedKeys.has(k)) {
        if (options.strict) {
          throw new TwinseedValidationError(
            `relations reference unknown key "${k}"`,
            rpath,
          );
        }
        return;
      }
    }
    const sig = [a, b].sort().join('\0');
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push([a, b]);
  });
  return out;
}

/* ------------------------------------------------------- synthetic tree */

/**
 * Build the <section> value for one item: fragment include first, nested
 * sections inside, then the related-links block and (top-level only) the
 * prev/next pager. The ld seed guarantees a graph node per section so
 * hasPart never dangles; fragments co-author the same node via @id merge.
 * @param {MapItem} item
 * @param {{ relatedByKey: Map<string, string[]>, sectionsByKey: Map<string, { key: string, navText: string }>, prev?: MapItem, next?: MapItem }} ctx
 */
function buildSectionNode(item, ctx) {
  /** @type {Array<Record<string, unknown>>} */
  const children = [];
  if (item.include !== undefined) children.push({ include: item.include });
  for (const child of item.children) {
    children.push({
      section: buildSectionNode(child, {
        relatedByKey: ctx.relatedByKey,
        sectionsByKey: ctx.sectionsByKey,
      }),
    });
  }

  const related = ctx.relatedByKey.get(item.key);
  if (related?.length) {
    children.push({
      nav: {
        class: 'verso-related',
        'aria-label': 'Related',
        children: [
          {
            ul: {
              children: related.map((k) => ({
                li: {
                  a: {
                    href: `#${k}`,
                    text: ctx.sectionsByKey.get(k)?.navText ?? k,
                  },
                },
              })),
            },
          },
        ],
      },
    });
  }

  if (ctx.prev || ctx.next) {
    /** @type {Array<Record<string, unknown>>} */
    const pagerItems = [];
    if (ctx.prev) {
      pagerItems.push({
        a: {
          rel: 'prev',
          href: `#${ctx.prev.key}`,
          text: `← ${ctx.prev.navText}`,
        },
      });
    }
    if (ctx.next) {
      pagerItems.push({
        a: {
          rel: 'next',
          href: `#${ctx.next.key}`,
          text: `${ctx.next.navText} →`,
        },
      });
    }
    children.push({ nav: { class: 'verso-pager', children: pagerItems } });
  }

  /** @type {Record<string, unknown>} */
  const ld = { '@id': `#${item.key}` };
  if (related?.length) {
    ld.isRelatedTo = related.map((k) => ({ '@id': `#${k}` }));
  }
  return { id: item.key, ld, children };
}

/**
 * Nested <ul> mirroring the items tree; items without nav: use their key.
 * @param {MapItem[]} items
 */
function buildNavList(items) {
  return {
    ul: {
      children: items.map((item) => {
        const link = { a: { href: `#${item.key}`, text: item.navText } };
        return item.children.length
          ? { li: { children: [link, buildNavList(item.children)] } }
          : { li: link };
      }),
    },
  };
}

/* ------------------------------------------------------------ graph root */

/**
 * Root-level JSON-LD for the publication: file-root @keys as the base,
 * map.ld on top (it describes the publication node), the merged @context
 * (map document + every fragment, deduped), and hasPart listing every
 * section @id in document order.
 * @param {Record<string, unknown>} raw
 * @param {{ ldBlock?: Record<string, unknown>, title?: string, sections: Array<{ key: string }> }} model
 * @param {unknown[]} fragmentContexts
 */
function buildRootLd(raw, model, fragmentContexts) {
  /** @type {Record<string, unknown>} */
  const rootLd = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('@') && k !== '@context') rootLd[k] = v;
  }
  if (model.ldBlock) {
    for (const [k, v] of Object.entries(model.ldBlock)) {
      if (k !== '@context') rootLd[k] = v;
    }
  }
  if (rootLd.name === undefined && model.title !== undefined) {
    rootLd.name = model.title;
  }

  /** @type {unknown[]} */
  const contextItems = [];
  const pushContext = (c) => {
    if (Array.isArray(c)) c.forEach(pushContext);
    else if (c !== undefined && c !== null) contextItems.push(c);
  };
  pushContext(raw['@context']);
  if (model.ldBlock) pushContext(model.ldBlock['@context']);
  fragmentContexts.forEach(pushContext);
  const contexts = dedupeContexts(contextItems);
  if (contexts.length === 1) rootLd['@context'] = contexts[0];
  else if (contexts.length > 1) rootLd['@context'] = contexts;

  rootLd.hasPart = model.sections.map((s) => ({ '@id': `#${s.key}` }));
  return rootLd;
}

/**
 * @param {unknown[]} items
 */
function dedupeContexts(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const sig = isPlainObject(item) ? JSON.stringify(item) : item;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(item);
  }
  return out;
}

/* --------------------------------------------------------- item chunking */

/**
 * Chunked render for params.item: full render already happened (graph,
 * cascade, refs all resolved against the whole map), so the chunk re-renders
 * just the located section subtree for its HTML — identical output, since
 * ld:/conventions never affect element HTML — and filters the graph down to
 * the publication node plus the section's node.
 * @param {import('./yamlDom.js').RenderResult} result full-map render
 * @param {unknown} keyedTree resolved synthetic tree
 * @param {{ sections: Array<{ key: string }> }} model
 * @param {Record<string, import('./conventions.js').ResolvedConvention>} registry
 * @param {string} item
 */
function extractItem(result, keyedTree, model, registry, item) {
  if (!model.sections.some((s) => s.key === item)) {
    throw new Error(
      `Twinseed map item not found: "${item}" — known keys: ${model.sections.map((s) => s.key).join(', ')}`,
    );
  }
  const entry = findSectionEntry(keyedTree, item);
  const itemResult = renderTree({ fragment: [entry] }, { registry });

  /** @type {Record<string, unknown>} */
  const itemLd = {};
  for (const [k, v] of Object.entries(result.ldJson)) {
    if (k !== '@graph') itemLd[k] = v;
  }
  const graph = Array.isArray(result.ldJson['@graph'])
    ? result.ldJson['@graph']
    : [];
  const sectionNode = graph.find(
    (n) => isPlainObject(n) && n['@id'] === `#${item}`,
  );
  if (sectionNode) itemLd['@graph'] = [sectionNode];

  return {
    ...result,
    html: itemResult.html,
    ldJson: itemLd,
    ldScript: `<script type="application/ld+json">${JSON.stringify(itemLd, null, 2)}</script>`,
    item,
  };
}

/**
 * Locate one { section: value } entry in the resolved tree by its id.
 * @param {unknown} node
 * @param {string} key
 * @returns {Record<string, unknown> | undefined}
 */
function findSectionEntry(node, key) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSectionEntry(child, key);
      if (found) return found;
    }
    return undefined;
  }
  if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'section' && isPlainObject(v) && v.id === key) {
        return { section: v };
      }
    }
    for (const v of Object.values(node)) {
      const found = findSectionEntry(v, key);
      if (found) return found;
    }
  }
  return undefined;
}
