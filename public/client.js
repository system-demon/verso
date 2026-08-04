/**
 * Browser client — JSON-RPC over Socket.IO + pushUpdate listener
 */

const SESSION_KEY = 'yml-dom-session';
const ITEM_ID = 'item_55';
const TEMPLATE = 'product';

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

const socket = io({
  query: { sessionId: sessionId() },
});

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
    price: document.getElementById('field-price').value,
    finish: document.getElementById('field-finish').value,
    description: document.getElementById('field-description').value,
  };
}

async function initialRender() {
  const result = await rpc('renderComponent', {
    componentId: TEMPLATE,
    data: formData(),
  });
  showHtml(result.html);
  showLd(result.ldJson);
}

socket.on('connect', async () => {
  setStatus(`live · ${sessionId()}`, 'is-live');
  try {
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

  // Sync form fields from pushed state when another client updated
  if (params.state) {
    if (params.state.name != null) document.getElementById('field-name').value = params.state.name;
    if (params.state.price != null) document.getElementById('field-price').value = params.state.price;
    if (params.state.finish != null) document.getElementById('field-finish').value = params.state.finish;
    if (params.state.description != null) {
      document.getElementById('field-description').value = params.state.description;
    }
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const result = await rpc('updateState', {
      itemId: ITEM_ID,
      componentId: TEMPLATE,
      updates: formData(),
    });
    // Local ack also applies (pushUpdate will fire to room including us)
    showHtml(result.newHtml);
    showLd(result.newLdJson);
  } catch (err) {
    setStatus(err.message, 'is-err');
  }
});
