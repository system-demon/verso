/**
 * ContentMap — tracks element text by CSS-style selectors
 * Built during Pass 1 (DOM generation), consumed by Pass 2 (LD resolution).
 */

export class ContentMap {
  constructor() {
    /** @type {Map<string, string>} */
    this.entries = new Map();
    /** @type {Map<string, { tag: string, id?: string, classes: string[], text: string, parentId?: string }>} */
    this.nodes = new Map();
  }

  /**
   * @param {string} selector
   * @param {string} text
   */
  set(selector, text) {
    this.entries.set(selector, String(text ?? '').trim());
  }

  /**
   * @param {string} selector
   * @returns {string|undefined}
   */
  get(selector) {
    if (this.entries.has(selector)) return this.entries.get(selector);

    // Fallback: resolve simple "#id .class" or "#id tag" patterns against nodes
    const match = selector.match(/^#([^\s.]+)(?:\s+(.+))?$/);
    if (!match) return undefined;

    const [, id, rest] = match;
    if (!rest) {
      const node = this.nodes.get(id);
      return node?.text;
    }

    const classMatch = rest.match(/^\.([\w-]+)$/);
    const tagMatch = rest.match(/^([\w-]+)$/);

    for (const node of this.nodes.values()) {
      if (node.parentId !== id && node.id !== id) continue;
      if (node.id === id && !rest) return node.text;
      // children under this id
      if (node.parentId === id || this._isDescendantOf(node, id)) {
        if (classMatch && node.classes.includes(classMatch[1])) return node.text;
        if (tagMatch && node.tag === tagMatch[1].toLowerCase()) return node.text;
      }
    }

    // Also check: selector like "#id .price" where the element itself has the id
    for (const node of this.nodes.values()) {
      if (node.id === id) {
        if (classMatch && node.classes.includes(classMatch[1])) return node.text;
        if (tagMatch && node.tag === tagMatch[1].toLowerCase()) return node.text;
      }
      // Direct children keyed by walking all nodes whose ancestor chain includes id
      if (this._isDescendantOf(node, id)) {
        if (classMatch && node.classes.includes(classMatch[1])) return node.text;
        if (tagMatch && node.tag === tagMatch[1].toLowerCase()) return node.text;
      }
    }

    return undefined;
  }

  /**
   * Register a rendered node for later selector lookup.
   * @param {{ tag: string, id?: string, classes?: string[], text?: string, parentId?: string, nodeId: string }} info
   */
  registerNode(info) {
    const classes = info.classes ?? [];
    const text = String(info.text ?? '').trim();
    this.nodes.set(info.nodeId, {
      tag: info.tag.toLowerCase(),
      id: info.id,
      classes,
      text,
      parentId: info.parentId,
    });

    if (info.id) {
      this.set(`#${info.id}`, text);
      this.set(`#${info.id} ${info.tag}`, text);
      for (const cls of classes) {
        this.set(`#${info.id} .${cls}`, text);
      }
    }

    if (info.parentId) {
      this.set(`#${info.parentId} ${info.tag}`, text);
      for (const cls of classes) {
        this.set(`#${info.parentId} .${cls}`, text);
      }
    }

    for (const cls of classes) {
      this.set(`.${cls}`, text);
    }
  }

  /**
   * @param {{ parentId?: string, id?: string }} node
   * @param {string} ancestorId
   */
  _isDescendantOf(node, ancestorId) {
    let current = node;
    const seen = new Set();
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      if (seen.has(current.parentId)) break;
      seen.add(current.parentId);
      current = [...this.nodes.values()].find((n) => n.id === current.parentId);
      if (!current) break;
    }
    return false;
  }

  toObject() {
    return Object.fromEntries(this.entries);
  }
}
