/**
 * JSON-RPC 2.0 method handlers for Twinseed
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBacklinks, renderFeed } from '../parser/feed.js';
import { renderYaml, toDocument } from '../parser/yamlDom.js';
import { parseProfile } from '../parser/profiles.js';
import {
  getItemState,
  setItemState,
  updateItemState,
} from './state.js';
import {
  addWatch,
  evaluateSessionWatches,
  listWatches,
  removeWatch,
} from './watches.js';

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
 * Resolve a seed path relative to the repo (for feed / backlinks).
 * @param {unknown} seedPath
 * @returns {string} absolute path
 */
export function clampSeedPath(seedPath) {
  if (typeof seedPath !== 'string' || !seedPath.trim()) {
    throw rpcError(-32602, 'path must be a non-empty string relative to the repo');
  }
  const resolved = path.resolve(REPO_ROOT, seedPath.replace(/\\/g, '/'));
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    throw rpcError(-32602, 'path must resolve inside the repository');
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw rpcError(-32001, `Seed not found: ${seedPath}`);
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

/**
 * Load YAML from params.yaml, params.path, or a named template.
 * @param {Record<string, unknown>} params
 */
function loadSeedSource(params) {
  if (typeof params?.yaml === 'string' && params.yaml.trim()) {
    return {
      source: params.yaml,
      baseDir: clampBaseDir(params.baseDir),
    };
  }
  if (typeof params?.path === 'string' && params.path.trim()) {
    const filePath = clampSeedPath(params.path);
    return {
      source: fs.readFileSync(filePath, 'utf8'),
      baseDir: clampBaseDir(params.baseDir) ?? path.dirname(filePath),
    };
  }
  if (typeof params?.componentId === 'string' || typeof params?.template === 'string') {
    const componentId = /** @type {string} */ (params.componentId ?? params.template);
    return {
      source: loadTemplate(componentId),
      baseDir: TEMPLATES_DIR,
    };
  }
  throw rpcError(-32602, 'params.yaml, params.path, or params.componentId is required');
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
   * Update live state and re-render the affected component / seed.
   * Prefer templates/concept.yml (or params.yaml|path) for knowledge docs;
   * product.yml remains for legacy demos only.
   * After render, session knowledge watches are evaluated (edge / change).
   */
  updateState(params = {}, ctx) {
    const sessionId = params.sessionId ?? ctx.sessionId ?? 'default';
    const itemId = params.itemId;
    const updates = params.updates ?? {};
    const profile = parseProfile(params.profile);

    if (!itemId) {
      throw rpcError(-32602, 'itemId is required');
    }

    const merged = updateItemState(sessionId, itemId, {
      ...(params.data && typeof params.data === 'object' ? params.data : {}),
      ...updates,
      id: updates.id ?? params.data?.id ?? itemId,
    });

    let source;
    let baseDir = TEMPLATES_DIR;
    if (
      (typeof params.yaml === 'string' && params.yaml.trim()) ||
      (typeof params.path === 'string' && params.path.trim())
    ) {
      const loaded = loadSeedSource(params);
      source = loaded.source;
      baseDir = loaded.baseDir ?? TEMPLATES_DIR;
    } else {
      const componentId = params.componentId ?? params.template ?? 'concept';
      source = loadTemplate(componentId);
    }

    const result = renderYaml(source, { params: merged, baseDir, profile });
    const alerts = evaluateSessionWatches(sessionId, result.contentMap);

    return {
      target: `#${itemId}`,
      newHtml: result.html,
      newLdJson: result.ldJson,
      contentMap: result.contentMap,
      state: merged,
      itemId,
      sessionId,
      alerts,
      ...(profile !== undefined ? { profile } : {}),
    };
  },

  /**
   * Register a knowledge watch for this session.
   * mode "when" (default): fire once when ld_if-style condition becomes true.
   * mode "change": fire whenever ContentMap[ref] changes after the first sample.
   */
  addWatch(params = {}, ctx) {
    const sessionId = params.sessionId ?? ctx.sessionId ?? 'default';
    return { sessionId, watch: addWatch(sessionId, params) };
  },

  removeWatch(params = {}, ctx) {
    const sessionId = params.sessionId ?? ctx.sessionId ?? 'default';
    return { sessionId, ...removeWatch(sessionId, params.watchId ?? params.id) };
  },

  listWatches(params = {}, ctx) {
    const sessionId = params.sessionId ?? ctx.sessionId ?? 'default';
    return listWatches(sessionId);
  },

  /**
   * Re-render a seed and evaluate watches without mutating item state.
   * Useful for probing conditions against yaml|path|componentId + data.
   */
  evaluateWatches(params = {}, ctx) {
    const sessionId = params.sessionId ?? ctx.sessionId ?? 'default';
    const profile = parseProfile(params.profile);
    let source;
    let baseDir = TEMPLATES_DIR;
    if (
      (typeof params.yaml === 'string' && params.yaml.trim()) ||
      (typeof params.path === 'string' && params.path.trim())
    ) {
      const loaded = loadSeedSource(params);
      source = loaded.source;
      baseDir = loaded.baseDir ?? TEMPLATES_DIR;
    } else {
      const componentId = params.componentId ?? params.template ?? 'concept';
      source = loadTemplate(componentId);
    }
    const result = renderYaml(source, {
      params: params.data ?? {},
      baseDir,
      profile,
    });
    const alerts = evaluateSessionWatches(sessionId, result.contentMap);
    return {
      sessionId,
      alerts,
      contentMap: result.contentMap,
      ldJson: result.ldJson,
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
   * Project a seed's JSON-LD graph into Atom or RSS (knowledge stream).
   * params.yaml | params.path | params.componentId — source
   * params.format — "atom" (default) | "rss" | "json"
   */
  renderFeed(params = {}, _ctx) {
    const { source, baseDir } = loadSeedSource(params);
    const format =
      params.format === 'rss' || params.format === 'json' || params.format === 'atom'
        ? params.format
        : 'atom';
    const profile = parseProfile(params.profile);
    const feed = renderFeed(source, {
      params: params.data ?? {},
      strict: params.strict === true ? true : undefined,
      baseDir,
      profile,
      format,
      selfHref: typeof params.selfHref === 'string' ? params.selfHref : undefined,
      feedLink: typeof params.feedLink === 'string' ? params.feedLink : undefined,
      title: typeof params.title === 'string' ? params.title : undefined,
    });
    return {
      format,
      xml: feed.xml,
      atom: feed.atom,
      rss: feed.rss,
      channel: feed.channel,
      items: feed.items,
      ldJson: feed.ldJson,
      ...(profile !== undefined ? { profile } : {}),
    };
  },

  /**
   * Inverse relations from map.relations + JSON-LD isRelatedTo / about / etc.
   * params.yaml | params.path | params.componentId — source
   * params.id — optional focus key ("json-ld" or "#json-ld")
   */
  getBacklinks(params = {}, _ctx) {
    const { source, baseDir } = loadSeedSource(params);
    const profile = parseProfile(params.profile);
    return getBacklinks(source, {
      baseDir,
      strict: params.strict === true ? true : undefined,
      profile,
      id: typeof params.id === 'string' ? params.id : undefined,
    });
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
