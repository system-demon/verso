/**
 * In-memory session / item state for real-time YML-DOM updates
 */

/** @type {Map<string, Record<string, Record<string, unknown>>>} */
const sessions = new Map();

/**
 * @param {string} sessionId
 */
export function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {});
  }
  return sessions.get(sessionId);
}

/**
 * @param {string} sessionId
 * @param {string} itemId
 * @param {Record<string, unknown>} data
 */
export function setItemState(sessionId, itemId, data) {
  const session = getSession(sessionId);
  session[itemId] = { ...(session[itemId] ?? {}), ...data };
  return session[itemId];
}

/**
 * @param {string} sessionId
 * @param {string} itemId
 * @param {Record<string, unknown>} updates
 */
export function updateItemState(sessionId, itemId, updates) {
  return setItemState(sessionId, itemId, updates);
}

/**
 * @param {string} sessionId
 * @param {string} itemId
 */
export function getItemState(sessionId, itemId) {
  return getSession(sessionId)[itemId] ?? {};
}

export function clearSessions() {
  sessions.clear();
}
