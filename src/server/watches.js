/**
 * Knowledge watches — session-scoped interests over ContentMap values.
 *
 * Docs / Semantic Web framing: watch concept versions, statuses, and
 * dependency fields. Reuses ld_if's evaluateCondition. Not a storefront
 * price-drop system.
 */

import { randomUUID } from 'node:crypto';
import { evaluateCondition } from '../parser/ldResolver.js';

/**
 * @typedef {object} KnowledgeWatch
 * @property {string} id
 * @property {'when'|'change'} mode
 * @property {object|string} condition
 * @property {string} [ref] selector used for change-mode / messaging
 * @property {string} [message]
 * @property {string} [conceptId] optional graph / fragment id for clients
 * @property {boolean} [lastTrue]
 * @property {string|undefined} [lastValue]
 */

/** @type {Map<string, Map<string, KnowledgeWatch>>} */
const bySession = new Map();

/**
 * @param {string} sessionId
 * @returns {Map<string, KnowledgeWatch>}
 */
function sessionMap(sessionId) {
  if (!bySession.has(sessionId)) bySession.set(sessionId, new Map());
  return bySession.get(sessionId);
}

/**
 * @param {unknown} params
 * @returns {KnowledgeWatch}
 */
function normalizeWatch(params = {}) {
  if (!params || typeof params !== 'object') {
    throw watchError(-32602, 'watch params must be an object');
  }

  const mode = params.mode === 'change' ? 'change' : 'when';
  const message =
    typeof params.message === 'string' && params.message.trim()
      ? params.message.trim()
      : undefined;
  const conceptId =
    typeof params.conceptId === 'string' && params.conceptId.trim()
      ? params.conceptId.trim()
      : typeof params.itemId === 'string' && params.itemId.trim()
        ? params.itemId.trim()
        : undefined;

  let condition = params.condition;
  let ref =
    typeof params.ref === 'string' && params.ref.trim()
      ? params.ref.trim()
      : undefined;

  if (condition === undefined) {
    if (!ref) {
      throw watchError(
        -32602,
        'addWatch requires condition or ref (ContentMap selector, e.g. "#spec .version")',
      );
    }
    if (mode === 'change') {
      condition = { ref };
    } else if (params.operator !== undefined) {
      condition = {
        ref,
        operator: params.operator,
        ...(params.value !== undefined ? { value: params.value } : {}),
      };
    } else {
      condition = { ref };
    }
  } else if (typeof condition === 'string') {
    condition = condition.trim();
    if (!condition) throw watchError(-32602, 'condition string must be non-empty');
    if (!ref) {
      const m = condition.match(/^(\S+)/);
      if (m) ref = m[1];
    }
  } else if (condition && typeof condition === 'object') {
    if (typeof condition.ref === 'string' && !ref) ref = condition.ref;
  } else {
    throw watchError(-32602, 'condition must be a string or { ref, operator?, value? }');
  }

  if (mode === 'change' && !ref) {
    throw watchError(-32602, 'mode "change" requires a ref selector');
  }

  const id =
    typeof params.id === 'string' && params.id.trim()
      ? params.id.trim()
      : randomUUID().slice(0, 8);

  return {
    id,
    mode,
    condition,
    ref,
    message:
      message ??
      (mode === 'change'
        ? `Value changed: ${ref}`
        : `Knowledge condition met: ${ref ?? 'watch'}`),
    conceptId,
    lastTrue: false,
    lastValue: undefined,
  };
}

function watchError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * @param {string} sessionId
 * @param {Record<string, unknown>} params
 */
export function addWatch(sessionId, params = {}) {
  const watch = normalizeWatch(params);
  const map = sessionMap(sessionId);
  map.set(watch.id, watch);
  return publicWatch(watch);
}

/**
 * @param {string} sessionId
 * @param {string} watchId
 */
export function removeWatch(sessionId, watchId) {
  if (typeof watchId !== 'string' || !watchId.trim()) {
    throw watchError(-32602, 'watchId is required');
  }
  const map = sessionMap(sessionId);
  const ok = map.delete(watchId.trim());
  return { removed: ok, id: watchId.trim() };
}

/**
 * @param {string} sessionId
 */
export function listWatches(sessionId) {
  return {
    sessionId,
    watches: [...sessionMap(sessionId).values()].map(publicWatch),
  };
}

/**
 * @param {KnowledgeWatch} watch
 */
function publicWatch(watch) {
  return {
    id: watch.id,
    mode: watch.mode,
    condition: watch.condition,
    ...(watch.ref ? { ref: watch.ref } : {}),
    message: watch.message,
    ...(watch.conceptId ? { conceptId: watch.conceptId } : {}),
  };
}

/**
 * Accept a live ContentMap or the plain object from renderYaml(...).contentMap.
 * @param {unknown} contentMap
 * @returns {{ get: (selector: string) => string|undefined }|null}
 */
function asLookup(contentMap) {
  if (contentMap && typeof contentMap.get === 'function') {
    return /** @type {{ get: (selector: string) => string|undefined }} */ (contentMap);
  }
  if (contentMap && typeof contentMap === 'object' && !Array.isArray(contentMap)) {
    const entries = /** @type {Record<string, string>} */ (contentMap);
    return {
      get(selector) {
        if (Object.prototype.hasOwnProperty.call(entries, selector)) {
          return entries[selector];
        }
        return undefined;
      },
    };
  }
  return null;
}

/**
 * Evaluate all watches for a session against a live ContentMap.
 * `when` mode is edge-triggered (false → true). `change` fires when the
 * ref's value differs from the last observed value (after the first sample).
 *
 * @param {string} sessionId
 * @param {{ get: (selector: string) => string|undefined }|Record<string, string>} contentMap
 * @returns {Array<Record<string, unknown>>}
 */
export function evaluateSessionWatches(sessionId, contentMap) {
  const lookup = asLookup(contentMap);
  if (!lookup) return [];

  /** @type {Array<Record<string, unknown>>} */
  const alerts = [];
  const map = sessionMap(sessionId);

  for (const watch of map.values()) {
    if (watch.mode === 'change') {
      const current = lookup.get(watch.ref) ?? '';
      const prev = watch.lastValue;
      watch.lastValue = current;
      if (prev !== undefined && prev !== current) {
        alerts.push({
          type: 'KNOWLEDGE_ALERT',
          mode: 'change',
          watchId: watch.id,
          message: watch.message,
          ref: watch.ref,
          previousValue: prev,
          currentValue: current,
          ...(watch.conceptId ? { conceptId: watch.conceptId } : {}),
        });
      }
      continue;
    }

    const now = evaluateCondition(watch.condition, lookup);
    const was = watch.lastTrue === true;
    watch.lastTrue = now;
    if (now && !was) {
      const current = watch.ref ? lookup.get(watch.ref) : undefined;
      alerts.push({
        type: 'KNOWLEDGE_ALERT',
        mode: 'when',
        watchId: watch.id,
        message: watch.message,
        ...(watch.ref ? { ref: watch.ref } : {}),
        ...(current !== undefined ? { currentValue: current } : {}),
        ...(watch.conceptId ? { conceptId: watch.conceptId } : {}),
      });
    }
  }

  return alerts;
}

/** Test / shutdown helper */
export function clearWatches(sessionId) {
  if (sessionId) bySession.delete(sessionId);
  else bySession.clear();
}
