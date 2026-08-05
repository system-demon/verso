/**
 * JSON-RPC 2.0 method handlers for Twinseed
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderYaml, toDocument } from '../parser/yamlDom.js';
import { parseProfile } from '../parser/profiles.js';
import {
  getItemState,
  setItemState,
  updateItemState,
} from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '../../templates');
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Resolve a client-supplied baseDir for includes, clamped to the repo.
 * Returns undefined when not supplied; throws on escape attempts.
 * @param {unknown} baseDir
 */
export function clampBaseDir(baseDir) {
  if (baseDir === undefined || baseDir === null || baseDir === '') return undefined;
  if (typeof baseDir !== 'string') {
    throw rpcError(-32602, 'baseDir must be a string path relative to the repo');
  }
  const resolved = path.resolve(REPO_ROOT, baseDir.replace(/\\/g, '/'));
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    throw rpcError(-32602, 'baseDir must resolve inside the repository');
  }
  return resolved;
}

/**
 * @param {string} name
 */
export function loadTemplate(name) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(TEMPLATES_DIR, `${safe}.yml`);
  if (!fs.existsSync(filePath)) {
    throw rpcError(-32001, `Template not found: ${safe}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function rpcError(code, message, data) {
  const err = new Error(message);
  err.code = code;
  err.data = data;
  return err;
}

/**
 * @type {Record<string, (params: any, ctx: { sessionId: string }) => unknown>}
 */
export const methods = {
  /**
   * Render a named template component with optional data injection.
   * params.item ("KEY"): when the template is a map document, return just
   * that section's HTML plus a ldJson holding the publication node and that
   * section's node — chunking a map into per-section payloads.
   * params.profile ({ audience, platform, product }): filter if:/flag:
   * against that profile (P4); echoed back in the result when supplied.
   */
  renderComponent(params = {}, ctx) {
    const componentId = params.componentId ?? params.template ?? 'product';
    const data = params.data ?? {};
    const sessionId = params.sessionId ?? ctx.sessionId ?? 'default';
    const itemId = data.id ?? params.itemId ?? 'default';
    const profile = parseProfile(params.profile);

    setItemState(sessionId, itemId, data);
    const merged = { ...getItemState(sessionId, itemId), ...data };

    const source = loadTemplate(componentId);
    const result = renderYaml(source, {
      params: merged,
      baseDir: TEMPLATES_DIR,
      item: typeof params.item === 'string' ? params.item : undefined,
      profile,
    });

    return {
      html: result.html,
      ldJson: result.ldJson,
      contentMap: result.contentMap,
      head: result.head,
      itemId,
      sessionId,
      ...(typeof params.item === 'string' ? { item: params.item } : {}),
      ...(profile !== undefined ? { profile } : {}),
    };
  },

  /**
   * Render a full HTML document from a template.
   */
  renderDocument(params = {}, ctx) {
    const out = methods.renderComponent(params, ctx);
    return {
      ...out,
      document: toDocument(
        { html: out.html, ldJson: out.ldJson, contentMap: out.contentMap, ldScript: `<script type="application/ld+json">${JSON.stringify(out.ldJson, null, 2)}</script>`, head: out.head },
        { title: params.title },
      ),
    };
  },

  /**
   * Update live state and re-render the affected component.
   */
  updateState(params = {}, ctx) {
    const sessionId = params.sessionId ?? ctx.sessionId ?? 'default';
    const itemId = params.itemId;
    const updates = params.updates ?? {};
    const componentId = params.componentId ?? params.template ?? 'product';
    const profile = parseProfile(params.profile);

    if (!itemId) {
      throw rpcError(-32602, 'itemId is required');
    }

    const merged = updateItemState(sessionId, itemId, updates);
    const source = loadTemplate(componentId);
    const result = renderYaml(source, { params: merged, baseDir: TEMPLATES_DIR, profile });

    return {
      target: `#${itemId}`,
      newHtml: result.html,
      newLdJson: result.ldJson,
      contentMap: result.contentMap,
      state: merged,
      itemId,
      sessionId,
      ...(profile !== undefined ? { profile } : {}),
    };
  },

  /**
   * Render inline YAML supplied in the request — no templates/ file needed.
   * Server-side counterpart of examples/06-custom-rpc.js.
   * params.item ("KEY") chunks map documents the same way as renderComponent.
   * params.profile filters if:/flag: against a profile (P4), echoed when given.
   */
  renderInline(params = {}, _ctx) {
    if (typeof params?.yaml !== 'string' || !params.yaml.trim()) {
      throw rpcError(-32602, 'params.yaml (non-empty string) is required');
    }
    const profile = parseProfile(params.profile);
    const result = renderYaml(params.yaml, {
      params: params.data ?? {},
      strict: params.strict === true ? true : undefined,
      item: typeof params.item === 'string' ? params.item : undefined,
      baseDir: clampBaseDir(params.baseDir),
      profile,
    });
    return {
      html: result.html,
      ldJson: result.ldJson,
      contentMap: result.contentMap,
      ...(typeof params.item === 'string' ? { item: params.item } : {}),
      ...(profile !== undefined ? { profile } : {}),
    };
  },

  /**
   * Return current item state.
   */
  getState(params = {}, ctx) {
    const sessionId = params.sessionId ?? ctx.sessionId ?? 'default';
    const itemId = params.itemId ?? 'default';
    return {
      sessionId,
      itemId,
      state: getItemState(sessionId, itemId),
    };
  },

  /**
   * List available templates.
   */
  listTemplates() {
    if (!fs.existsSync(TEMPLATES_DIR)) return { templates: [] };
    const templates = fs
      .readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith('.yml'))
      .map((f) => f.replace(/\.yml$/, ''));
    return { templates };
  },

  /**
   * Ping
   */
  ping() {
    return { ok: true, pong: Date.now() };
  },
};

/**
 * Register a custom JSON-RPC method (for plugins / examples).
 * @param {string} name
 * @param {(params: any, ctx: { sessionId: string }) => unknown} handler
 */
export function registerMethod(name, handler) {
  if (!name || typeof handler !== 'function') {
    throw new Error('registerMethod(name, handler) requires a name and function');
  }
  if (methods[name]) {
    throw new Error(`RPC method already exists: ${name}`);
  }
  methods[name] = handler;
}

/**
 * Dispatch a JSON-RPC 2.0 request object.
 * @param {object} request
 * @param {{ sessionId?: string }} [ctx]
 */
export function handleRpc(request, ctx = {}) {
  if (!request || request.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request' },
      id: request?.id ?? null,
    };
  }

  const method = methods[request.method];
  if (!method) {
    return {
      jsonrpc: '2.0',
      error: { code: -32601, message: `Method not found: ${request.method}` },
      id: request.id ?? null,
    };
  }

  try {
    const result = method(request.params ?? {}, {
      sessionId: ctx.sessionId ?? 'default',
    });
    return {
      jsonrpc: '2.0',
      result,
      id: request.id ?? null,
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      error: {
        code: err.code ?? -32000,
        message: err.message ?? 'Server error',
        data: err.data,
      },
      id: request.id ?? null,
    };
  }
}
