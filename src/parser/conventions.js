/**
 * Convention Registry — Implicit Schema Mapping
 * CSS trigger classes → Schema.org types + field selectors
 */

/**
 * @typedef {{ type: string, fields: Record<string, string>, transform?: (entity: object) => object }} Convention
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
  if (!convention?.type || !convention?.fields) {
    throw new Error('convention requires { type, fields }');
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
 * Discover implicit JSON-LD entities from rendered nodes.
 * @param {import('./contentMap.js').ContentMap} contentMap
 * @param {Array<{ id?: string, classes: string[] }>} elements
 * @returns {object[]}
 */
export function discoverImplicitSchemas(contentMap, elements) {
  const entities = [];

  for (const el of elements) {
    const classList = el.classes ?? [];
    for (const [trigger, schema] of Object.entries(ConventionRegistry)) {
      if (!classList.includes(trigger)) continue;

      const entity = { '@type': schema.type };
      const scope = el.id ? `#${el.id}` : null;

      for (const [schemaKey, selector] of Object.entries(schema.fields)) {
        const fullSelector = scope ? `${scope} ${selector}` : selector;
        const value = contentMap.get(fullSelector) ?? contentMap.get(selector);
        if (value !== undefined && value !== '') {
          entity[schemaKey] = value;
        }
      }

      // Nest Offer when price is present on Product
      if (schema.type === 'Product' && entity.price !== undefined) {
        entity.offers = {
          '@type': 'Offer',
          price: entity.price,
          priceCurrency: 'USD',
        };
        delete entity.price;
      }

      // Nest Rating when ratingValue is present on Review
      if (schema.type === 'Review' && entity.ratingValue !== undefined) {
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
