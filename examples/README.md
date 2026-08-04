# Examples: extend & customize

Each example is runnable. YAML files use the CLI; `.js` files register extensions then render.

```bash
# From repo root
npm run render -- examples/01-basic.yml --json
node examples/05-register-convention.js
node examples/06-custom-rpc.js
```

These samples show how **Verso** grows the **presentational tree** and the **linked-data graph** together — not as separate authoring passes.

---

## 1. Basic markup — `01-basic.yml`

Indentation = tree. Attributes vs text vs children:

```bash
npm run render -- examples/01-basic.yml
```

**Customize:** any HTML tag name works as a key. Add `data-*` / `aria-*` attributes the same way as `class`.

---

## 2. Ordered siblings — `02-children.yml`

YAML maps cannot have two `span:` keys. Use `children:` (or `$:`):

```bash
npm run render -- examples/02-children.yml
```

**Customize:** each list item is a one-key map `{ tag: ... }`. Nest `children:` as deep as you need.

---

## 3. Reactive JSON-LD — `03-reactive-ld.yml`

`{ ref: "#id .class" }` binds a graph property to presentational text after the HTML pass (same fact, two consumers):

```bash
npm run render -- examples/03-reactive-ld.yml --json
```

**Customize:** refs are CSS-like: `#id`, `#id tag`, `#id .class`, or `.class`. Keep an `id` on the scope element so node identity stays stable in the graph. `@context` may be a string, an array, or a map (all preserved as-is; `@context` inside an `ld:` block is hoisted and merged into the document context), and an `@id` key on any element becomes the entity's graph node id.

---

## 4. Conditional assertions — `04-ld-if.yml`

`ld_if` picks `then` or `else` from a comparison against the ContentMap — typed claims that depend on the data in the tree:

```bash
npm run render -- examples/04-ld-if.yml --json
```

Operators: `<`, `>`, `<=`, `>=`, `==`, `!=`, `contains`, `exists`. Omit the operator (and `value`) for a plain truthiness check on the ref.

**Customize:** change `value` / `operator`, or add more properties inside `then` / `else`. Combine with a normal `ld:` block on the same element.

---

## 5. Vocabulary conventions — `05-implicit.yml`

Trigger classes in `ConventionRegistry` auto-emit typed JSON-LD entities (built-ins use the Schema.org vocabulary as `@context`):

| Class | Type | Looks for |
|-------|------|-----------|
| `product` | `Product` | `.name`, `.description`, `.price` |
| `review` | `Review` | `.reviewBody`, `.rating` |
| `article` | `Article` | `.headline`, `.author`, `.datePublished` |

```bash
npm run render -- examples/05-implicit.yml --json
```

**Customize without code:** use those class names in your YAML. **Customize with code:** see example 6 — register any vocabulary type you need.

---

## 6. Register a new convention — `05-register-convention.js`

Adds an `event` trigger → typed `Event` (Schema.org terms here), then renders `06-event.yml`:

```bash
node examples/05-register-convention.js
```

Pattern:

```js
import { registerConvention } from '../src/parser/conventions.js';
import { renderYaml } from '../src/parser/yamlDom.js';

registerConvention('event', {
  type: 'Event',
  fields: {
    name: '.name',
    startDate: '.startDate',
    location: '.location',
  },
  // optional: shape blank nodes / nested entities
  transform(entity) {
    if (entity.location) {
      entity.location = { '@type': 'Place', name: entity.location };
    }
    return entity;
  },
});
```

Put `class: "event"` on a container and child classes matching `fields`. Point `@context` at whatever vocabulary those types belong to.

---

## 7. Parameterized templates — `07-template.yml`

`{{name}}` placeholders are filled from CLI `key=value` or RPC `params.data` — inject entity values into both the view and the derived graph:

```bash
npm run render -- examples/07-template.yml --json id=sku_1 name="Bolt" price=4.50 sku="B-100"
```

**Customize:** drop a new file in `templates/my-card.yml`, then call RPC with `"componentId": "my-card"`. Only `[a-zA-Z0-9_-]` names are allowed.

---

## 8. Custom JSON-RPC method — `06-custom-rpc.js`

Registers `renderSnippet` (renders inline YAML from the request body; returns HTML + JSON-LD):

```bash
node examples/06-custom-rpc.js
```

Pattern:

```js
import { registerMethod, handleRpc } from '../src/server/rpc.js';
import { renderYaml } from '../src/parser/yamlDom.js';

registerMethod('renderSnippet', (params) => {
  const result = renderYaml(params.yaml, { params: params.data ?? {} });
  return { html: result.html, ldJson: result.ldJson };
});
```

Wire `registerMethod` in `src/server/index.js` (or an imported plugin) before accepting connections so the live server exposes it.

---

## 9. Live client styling — `public/`

The demo mounts RPC HTML into `#mount`. Convention-driven cards are styled via `.mount .product …` in `public/styles.css` (presentation only; the graph is in the JSON-LD panel).

**Customize:**

1. Add classes in your template YAML.
2. Target them under `.mount` in CSS (or your own page).
3. Listen for `pushUpdate` in `public/client.js` if you need extra client logic when the graph/view pair refreshes.

---

## 10. Graph shaping — `08-graph-merge.yml`

Entities that share an `@id` merge into a single graph node instead of separate `@graph` entries — so `ld:`, `ld_if`, and convention-harvested entities can all co-author the same subject:

```bash
npm run render -- examples/08-graph-merge.yml --json
```

**Customize:** give two elements the same `@id` (explicit `@id:` key, or derived automatically as `#<id>` from the HTML `id`) and their properties deep-merge; differing `@type`s union into an array.

---

## Extension checklist

| Goal | Where |
|------|--------|
| New page/component markup | `templates/*.yml` or `examples/*.yml` |
| New vocabulary type from classes | `registerConvention(...)` |
| Conditional assertions | `ld_if` in the YAML |
| Bind graph properties to UI text | `ld:` + `{ ref }` |
| New remote publish API | `registerMethod(...)` in RPC |
| Real-time push of view + graph | `src/server/index.js` `pushUpdate` emit |
| Parser / attribute rules | `ATTR_KEYS` / `TEXT_KEYS` in `yamlDom.js` |

When in doubt: start from a YAML example, render with `--json`, inspect `html` + `ldJson` + `contentMap`, then add a convention or RPC method only if the markup alone is not enough.
