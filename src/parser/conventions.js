/**
 * Convention Registry — presentational class → vocabulary type
 * Maps CSS trigger classes to JSON-LD @type + field selectors
 * (built-ins use Schema.org terms; registerConvention() for any vocabulary)
 *
 * Conventions may also be declared in YAML via a top-level `conventions:`
 * block; those merge into a per-render copy of the registry (the exported
 * global is never mutated). Both JS- and YAML-declared conventions support
 * single inheritance via `extends:` plus strict-mode `requires:` field checks.
 */

/**
 * @typedef {object} Convention
 * @property {string} [type] JSON-LD @type (omittable when `extends` supplies one)
 * @property {Record<string, string>} [fields] JSON-LD property → selector
 * @property {(entity: object) => object} [transform] JS-only post-hook
 * @property {string} [extends] parent convention trigger class
 * @property {string[]} [requires] selectors that must exist for strict mode
 */

/**
 * Resolved convention (inheritance applied) used during a render.
 * @typedef {object} ResolvedConvention
 * @property {string|undefined} type own (or inherited) @type
 * @property {string[]} types ancestor-first @type union
 * @property {Record<string, string>} fields merged child-over-parent
 * @property {string[]} [requires] merged parent + child requires
 * @property {(entity: object) => object} [transform] composed parent-first
 * @property {string[]} lineage ancestor-first trigger chain, ending with self
 */

/** @type {Record<string, Convention>} */
export const ConventionRegistry = {
  product: {
    type: 'Product',
    fields: {
      name: '.name',
      description: '.description',
      price: '.price',
    },
  },
  review: {
    type: 'Review',
    fields: {
      reviewBody: '.reviewBody',
      ratingValue: '.rating',
    },
  },
  article: {
    type: 'Article',
    fields: {
      headline: '.headline',
      author: '.author',
      datePublished: '.datePublished',
    },
  },
};

/**
 * Register or replace a convention trigger class.
 * @param {string} triggerClass  e.g. "event"
 * @param {Convention} convention
 */
export function registerConvention(triggerClass, convention) {
  if (!triggerClass || typeof triggerClass !== 'string') {
    throw new Error('triggerClass must be a non-empty string');
  }
  if (!convention?.extends && (!convention?.type || !convention?.fields)) {
    throw new Error('convention requires { type, fields } (or an "extends" to inherit them)');
  }
  ConventionRegistry[triggerClass] = convention;
}

/**
 * @param {string} triggerClass
 */
export function unregisterConvention(triggerClass) {
  delete ConventionRegistry[triggerClass];
}

/**
 * Compose parent-then-child transforms; either side may be missing or a
 * non-function (YAML declarations can't carry functions — strict mode flags
 * those separately).
 * @param {unknown} parentT
 * @param {unknown} childT
 */
function composeTransforms(parentT, childT) {
  const p = typeof parentT === 'function' ? parentT : undefined;
  const c = typeof childT === 'function' ? childT : undefined;
  if (p && c) return (entity) => c(p(entity));
  return c ?? p;
}

/**
 * Merge YAML-declared conventions into a copy of the base registry and
 * resolve `extends:` chains into effective conventions. The base registry is
 * never mutated. YAML declarations win over same-named base entries.
 * @param {Record<string, Convention>} [base]
 * @param {Record<string, Convention>} [yamlConventions]
 * @returns {Record<string, ResolvedConvention>}
 */
export function buildRenderRegistry(base = ConventionRegistry, yamlConventions = {}) {
  /** @type {Record<string, Convention>} */
  const merged = { ...base };
  for (const [name, def] of Object.entries(yamlConventions ?? {})) {
    if (def && typeof def === 'object' && !Array.isArray(def)) merged[name] = def;
  }

  /** @type {Record<string, ResolvedConvention>} */
  const resolved = {};
  /** @type {Set<string>} */
  const stack = new Set();

  /** @param {string} name @returns {ResolvedConvention|undefined} */
  const resolve = (name) => {
    if (resolved[name]) return resolved[name];
    const conv = merged[name];
    if (!conv || typeof conv !== 'object') return undefined;
    if (stack.has(name)) {
      throw new Error(`Verso convention extends cycle: ${[...stack, name].join(' → ')}`);
    }
    stack.add(name);
    // Missing parents are tolerated here (lenient); strict mode validates
    // extends targets against the merged registry before rendering.
    const parent =
      typeof conv.extends === 'string' && conv.extends !== name
        ? resolve(conv.extends)
        : undefined;
    stack.delete(name);

    const types = parent ? [...parent.types] : [];
    if (typeof conv.type === 'string' && !types.includes(conv.type)) {
      types.push(conv.type);
    }
    /** @type {ResolvedConvention} */
    const entry = {
      type: typeof conv.type === 'string' ? conv.type : parent?.type,
      types,
      fields: { ...(parent?.fields ?? {}), ...(conv.fields ?? {}) },
      lineage: [...(parent?.lineage ?? []), name],
    };
    const requires = [
      ...(parent?.requires ?? []),
      ...(Array.isArray(conv.requires) ? conv.requires : []),
    ].filter((r) => typeof r === 'string');
    if (requires.length) entry.requires = [...new Set(requires)];
    const transform = composeTransforms(parent?.transform, conv.transform);
    if (transform) entry.transform = transform;
    resolved[name] = entry;
    return entry;
  };

  for (const name of Object.keys(merged)) resolve(name);
  return resolved;
}

/**
 * Triggers in `classList` that have a convention, reduced to the most
 * specific: when both an ancestor convention and its descendant match the
 * same element, only the descendant emits an entity.
 * @param {string[]} classList
 * @param {Record<string, ResolvedConvention>} registry resolved registry
 * @returns {Array<[string, ResolvedConvention]>}
 */
export function matchConventions(classList, registry) {
  const matched = Object.entries(registry).filter(([trigger]) =>
    classList.includes(trigger),
  );
  return matched.filter(
    ([trigger]) =>
      !matched.some(
        ([other, otherConv]) =>
          other !== trigger && (otherConv.lineage ?? [other]).includes(trigger),
      ),
  );
}

/**
 * Discover implicit JSON-LD entities from rendered nodes.
 * Elements with an explicit `@id` (or an HTML `id`) carry it as the entity's
 * graph node id, so they can merge with ld:/ld_if contributions on that node.
 * @param {import('./contentMap.js').ContentMap} contentMap
 * @param {Array<{ id?: string, classes: string[], graphId?: string }>} elements
 * @param {Record<string, ResolvedConvention>} [registry] resolved registry
 *   (defaults to the global registry with inheritance resolved per call)
 * @returns {object[]}
 */
export function discoverImplicitSchemas(contentMap, elements, registry) {
  const reg = registry ?? buildRenderRegistry(ConventionRegistry, {});
  const entities = [];

  for (const el of elements) {
    const classList = el.classes ?? [];
    for (const [, schema] of matchConventions(classList, reg)) {
      const types = schema.types ?? (schema.type ? [schema.type] : []);
      /** @type {Record<string, unknown>} */
      const entity = {};
      if (types.length === 1) entity['@type'] = types[0];
      else if (types.length > 1) entity['@type'] = [...types];
      const graphId = el.graphId ?? (el.id ? `#${el.id}` : undefined);
      if (graphId) entity['@id'] = graphId;
      const scope = el.id ? `#${el.id}` : null;

      for (const [schemaKey, selector] of Object.entries(schema.fields ?? {})) {
        const fullSelector = scope ? `${scope} ${selector}` : selector;
        const value = contentMap.get(fullSelector) ?? contentMap.get(selector);
        if (value !== undefined && value !== '') {
          entity[schemaKey] = value;
        }
      }

      // Nest Offer when price is present on Product (or a Product descendant)
      if (types.includes('Product') && entity.price !== undefined) {
        entity.offers = {
          '@type': 'Offer',
          price: entity.price,
          priceCurrency: 'USD',
        };
        delete entity.price;
      }

      // Nest Rating when ratingValue is present on Review (or a descendant)
      if (types.includes('Review') && entity.ratingValue !== undefined) {
        entity.reviewRating = {
          '@type': 'Rating',
          ratingValue: entity.ratingValue,
        };
        delete entity.ratingValue;
      }

      const finalEntity =
        typeof schema.transform === 'function' ? schema.transform(entity) : entity;
      entities.push(finalEntity);
    }
  }

  return entities;
}
