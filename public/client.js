/**
 * Browser client — JSON-RPC over Socket.IO + pushUpdate / knowledgeAlert
 */

const SESSION_KEY = 'twinseed-session';
const ITEM_ID = 'json-rpc';
const TEMPLATE = 'concept';

function sessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `sess_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

const statusEl = document.getElementById('status');
const mountEl = document.getElementById('mount');
const ldOut = document.getElementById('ld-out');
const form = document.getElementById('update-form');
const alertBanner = document.getElementById('alert-banner');

const socket = io({
  query: { sessionId: sessionId() },
});

let alertHideTimer = 0;

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.classList.remove('is-live', 'is-err');
  if (cls) statusEl.classList.add(cls);
}

function showLd(ld) {
  ldOut.innerHTML = `<code>${escapeHtml(JSON.stringify(ld, null, 2))}</code>`;
}

function showHtml(html) {
  mountEl.innerHTML = html;
  mountEl.classList.remove('is-flash');
  // retrigger animation
  void mountEl.offsetWidth;
  mountEl.classList.add('is-flash');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Small toast matching the book-spread UI (no emoji).
 * @param {Array<Record<string, unknown>>} alerts
 */
function showAlerts(alerts) {
  if (!Array.isArray(alerts) || !alerts.length || !alertBanner) return;
  const lines = alerts.map((a) => {
    const msg = typeof a.message === 'string' ? a.message : 'Knowledge alert';
    const detail =
      a.mode === 'change' && a.previousValue != null && a.currentValue != null
        ? ` (${a.previousValue} → ${a.currentValue})`
        : a.currentValue != null
          ? ` (${a.currentValue})`
          : '';
    return `${msg}${detail}`;
  });
  alertBanner.hidden = false;
  alertBanner.textContent = lines.join(' · ');
  alertBanner.classList.remove('is-fade');
  void alertBanner.offsetWidth;
  alertBanner.classList.add('is-show');
  clearTimeout(alertHideTimer);
  alertHideTimer = window.setTimeout(() => {
    alertBanner.classList.remove('is-show');
    alertBanner.classList.add('is-fade');
    window.setTimeout(() => {
      alertBanner.hidden = true;
      alertBanner.textContent = '';
      alertBanner.classList.remove('is-fade');
    }, 400);
  }, 5200);
}

/**
 * @param {string} method
 * @param {object} params
 */
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: '2.0',
      method,
      params: { ...params, sessionId: sessionId() },
      id: Date.now(),
    };
    socket.emit('rpc', request, (response) => {
      if (!response) return reject(new Error('No response'));
      if (response.error) return reject(new Error(response.error.message));
      resolve(response.result);
    });
  });
}

function formData() {
  return {
    id: ITEM_ID,
    name: document.getElementById('field-name').value,
    description: document.getElementById('field-description').value,
    version: document.getElementById('field-version').value,
    status: document.getElementById('field-status').value,
  };
}

function syncForm(state) {
  if (!state) return;
  if (state.name != null) document.getElementById('field-name').value = state.name;
  if (state.description != null) {
    document.getElementById('field-description').value = state.description;
  }
  if (state.version != null) document.getElementById('field-version').value = state.version;
  if (state.status != null) document.getElementById('field-status').value = state.status;
}

async function registerWatches() {
  await rpc('addWatch', {
    id: 'version-bump',
    mode: 'change',
    ref: `#${ITEM_ID} .version`,
    conceptId: ITEM_ID,
    message: 'Concept version changed — review dependents.',
  });
  await rpc('addWatch', {
    id: 'deprecated',
    mode: 'when',
    ref: `#${ITEM_ID} .status`,
    operator: '==',
    value: 'deprecated',
    conceptId: ITEM_ID,
    message: 'Warning: concept marked deprecated.',
  });
}

async function initialRender() {
  // Prime change-watches with a silent sample (no alert on first observation)
  const result = await rpc('updateState', {
    itemId: ITEM_ID,
    componentId: TEMPLATE,
    data: formData(),
    updates: {},
  });
  showHtml(result.newHtml);
  showLd(result.newLdJson);
}

socket.on('connect', async () => {
  setStatus(`live · ${sessionId()}`, 'is-live');
  try {
    await registerWatches();
    await initialRender();
  } catch (err) {
    setStatus(err.message, 'is-err');
  }
});

socket.on('disconnect', () => {
  setStatus('disconnected', 'is-err');
});

socket.on('pushUpdate', (msg) => {
  const params = msg?.params ?? msg;
  if (!params) return;
  if (params.newHtml) showHtml(params.newHtml);
  if (params.newLdJson) showLd(params.newLdJson);
  syncForm(params.state);
});

socket.on('knowledgeAlert', (msg) => {
  const params = msg?.params ?? msg;
  if (params?.alerts) showAlerts(params.alerts);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const result = await rpc('updateState', {
      itemId: ITEM_ID,
      componentId: TEMPLATE,
      updates: formData(),
    });
    showHtml(result.newHtml);
    showLd(result.newLdJson);
    // Local ack may include alerts before the room broadcast arrives
    if (result.alerts?.length) showAlerts(result.alerts);
  } catch (err) {
    setStatus(err.message, 'is-err');
  }
});
