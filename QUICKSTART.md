# Quickstart

**Twinseed** turns a YAML tree into HTML for browsers and **JSON-LD** for the Semantic Web — from the same source. Optional JSON-RPC and WebSockets keep the presentational view and the linked-data graph in sync when state changes.

> One seed, two leaves.

## Requirements

- Node.js 18+

## Install & run

```bash
npm install
npm start
```

Open [http://localhost:3847](http://localhost:3847). Edit the fields and submit — the rendered fragment and the JSON-LD panel update together. Open a second tab to see live sync of both layers.

npm scripts: `start` (server), `dev` (server with `--watch` auto-restart), `render` (CLI), `watch` (CLI, re-render on change), `examples` (the two `.js` extension samples).

## CLI

Render a seed — the YAML genome is the source of truth; flags only choose how the leaves are shown.

```bash
node src/cli.js --help
node src/cli.js templates/demo.yml            # HTML fragment + JSON-LD script (default)
node src/cli.js templates/demo.yml --json     # { html, ldJson, contentMap } as JSON
node src/cli.js templates/demo.yml --doc      # full HTML document, JSON-LD in <head>
node src/cli.js templates/demo.yml --watch    # re-render on change (status on stderr)
node src/cli.js templates/demo.yml --strict   # validate first (also TWINSEED_STRICT=1)

# Fill {{placeholders}} with entity / graph data
node src/cli.js templates/product.yml --json id=item_1 name="Widget" price=19.99

# Profile for if:/flag: — key=value pairs after the flag, until the next --flag
node src/cli.js examples/16-profiles.yml --profile audience=admin platform=web

# Print the resolved intermediate tree as YAML instead of rendering
node src/cli.js examples/12-keys.yml --emit resolved
```

`--emit resolved` shows exactly what the renderer consumes: the document after include inlining, profile filtering, `{{param}}` injection, and `{ key }` substitution. It composes with `KEY=value` params and `--profile`; for `map:` documents it prints the assembled tree (sections, nav) pre-render.

Via npm: `npm run render -- templates/demo.yml --json`, `npm run watch -- examples/12-keys.yml`.

Shell helpers (prompt chrome + tab completion): [`shell/README.md`](shell/README.md).

## Minimal Twinseed file

```yaml
body:
  main:
    h1: "Hello"
    p: |
      Multi-line text uses a YAML block scalar.
    div:
      class: "card"
      id: "c1"
      children:
        - p:
            class: "name"
            text: "Card title"
        - span:
            class: "price"
            text: "9.99"
```

Notes:

- Keys are HTML tags (`div`, `h1`, `p`, …).
- Use `text:` (or a bare string) for content; use `class`, `id`, `href`, `style`, etc. for attributes.
- YAML maps cannot repeat the same key — put siblings in a `children:` list.
- Bare `@context` / `@type` keys are fine; the parser quotes them for `js-yaml`.

## Linked data

The same tree can carry JSON-LD. `@context` may be a string, an array, or a map (all preserved as-is). Schema.org is used below as a familiar vocabulary; any `@context` works the same way.

**Implicit** — a convention maps a presentational class to a typed entity and harvests child fields (built-ins: `product`, `review`, `article`):

```yaml
div:
  class: "product"
  id: "item_1"
  children:
    - h1: { class: "name", text: "Widget" }
    - span: { class: "price", text: "19.99" }
```

**Reactive** — `{ ref }` binds graph properties to the presentational content (one fact, two views):

```yaml
ld:
  "@type": Product
  name: { ref: "#item_1 .name" }
  offers:
    "@type": Offer
    price: { ref: "#item_1 .price" }
    priceCurrency: USD
```

**Conditional** — `ld_if` picks assertions from a comparison against the ContentMap (operators: `<`, `>`, `<=`, `>=`, `==`, `!=`, `contains`, `exists`):

```yaml
ld_if:
  condition: { ref: "#item_1 .price", operator: "<", value: 100 }
  then: { "@type": BudgetProduct }
  else: { "@type": PremiumProduct }
```

**Identity** — `@id:` on any element names its graph node; two elements sharing an `@id` deep-merge into one node (differing `@type`s union).

Examples: [examples/03-reactive-ld.yml](examples/03-reactive-ld.yml), [examples/04-ld-if.yml](examples/04-ld-if.yml), [examples/05-implicit.yml](examples/05-implicit.yml), [examples/08-graph-merge.yml](examples/08-graph-merge.yml).

## Keys — `{ key: name }`

A top-level `keys:` block binds symbolic names; `{ key: name }` resolves them in `text:`, attributes, `ld:` / `ld_if` values, and `include:` paths. Literal and `{ href }` keys substitute pre-render; `{ ref }`-valued keys (ld positions only) resolve post-render against the ContentMap. Keys cascade into included partials — first definition wins. Strict mode errors on unknown keys.

```yaml
keys:
  product-name: "WonderWidget"
  support: { href: "https://example.com/support" }

div:
  class: "product"
  id: "item_1"
  ld:
    "@type": Product
    name: { key: product-name }
  children:
    - h1: { class: "name", text: { key: product-name } }
    - a: { href: { key: support }, text: "Support" }
```

Example: [examples/12-keys.yml](examples/12-keys.yml).

## YAML conventions — `extends:` + `requires:`

Conventions can be declared in the file itself, with single inheritance: fields merge child-over-parent, `@type`s union ancestor-first (`["Product", "Vehicle"]`). `requires:` adds a `--strict` contract — every matching element must carry each selector.

```yaml
conventions:
  vehicle:
    extends: product
    type: Vehicle
    fields: { sku: ".sku" }
    requires: [.name, .sku]

vehicle:            # entity shorthand → <div class="vehicle">
  id: "car_7"
  children:
    - h1: { class: "name", text: "Roadster" }
    - span: { class: "sku", text: "R-1000" }
    - span: { class: "price", text: "42000" }
```

Example: [examples/13-extends.yml](examples/13-extends.yml).

## Maps — composition documents

A top-level `map:` makes the file a publication: the map owns structure (order, nav, relations, pagination) while included fragments own content. Output: each item wrapped in `<section id="KEY">`, a `<nav>` mirroring the item tree, related-link lists from `relations:`, prev/next pagers, and a `CollectionPage` node whose `hasPart` lists every section.

```yaml
"@context": "https://schema.org"
map:
  title: "WonderWidget Docs"
  ld: { "@type": CollectionPage }
  keys: { product-name: "WonderWidget" }   # cascades into all fragments
  items:
    - key: intro
      include: "intro.yml"                 # relative to the map file
      nav: "Introduction"
    - key: pricing
      include: "pricing.yml"
      nav: "Pricing"
  relations:
    - [intro, pricing]                     # related-links pair
```

```bash
node src/cli.js examples/14-map/site.map.yml --doc
```

Map-level `keys:`, `conventions:`, and `@context` cascade into fragments; `head:` does not. Over RPC, `params.item: "KEY"` returns just that section's HTML plus its slice of the graph.

Example: [examples/14-map/](examples/14-map/).

## Element-level includes — `file.yml#id`

`include:` with a fragment pulls one element (by its `id:`) out of a partial — conref-lite. The pulled element keeps its own tag; the including node's other keys merge over it (local keys win, classes union deduped). A key whose value carries `#id` is a conkeyref.

```yaml
footer:
  include: "partials/legal.yml#copyright"   # the element whose id: is "copyright"
  class: "site-footer"                      # unions with the element's own class
```

Whole-file includes (`include: "partials/footer.yml"`) work too — map partials merge as defaults, list partials become children.

Examples: [examples/15-include-id.yml](examples/15-include-id.yml), [examples/10-include.yml](examples/10-include.yml).

## Profiles — `if:` / `flag:`

Presentation-side conditionality against a per-render profile (fixed vocabulary: `audience`, `platform`, `product`). `if:` excludes before includes/params/keys resolve — filtered content never renders and never asserts into the graph. `flag:` never excludes; it adds a `flag-<value>` class when the whole condition matches. No profile supplied → everything renders, unflagged.

```yaml
div:
  class: "admin-panel"
  if: { audience: admin }        # rendered only when the profile has audience=admin

p:
  if: "platform == 'web'"        # string form: == and != only

span:
  text: "New in 2.0"
  flag: { audience: novice }     # always kept; gains flag-novice when matched
```

```bash
node src/cli.js examples/16-profiles.yml --profile audience=admin platform=web
```

RPC: `params.profile: { "audience": "admin" }` on `renderComponent`, `renderDocument`, `renderInline`, `updateState`.

Example: [examples/16-profiles.yml](examples/16-profiles.yml).

## Server endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /rpc` | JSON-RPC 2.0 (methods below); also over Socket.IO as `rpc` messages |
| `POST /render` | Raw YAML (`Content-Type: text/yaml`) or `{ "yaml", "data", "strict" }`; query `?format=json\|html\|doc`, `?strict=1` |
| `GET /health` | `{ ok, service, port }` |
| `GET /` | Live demo client (`public/`) |
| `GET /live/` | Reading room (`live/`) |
| Socket.IO | `pushUpdate` broadcasts HTML + JSON-LD to the session on `updateState` |

RPC methods: `renderComponent`, `renderDocument`, `renderInline`, `updateState`, `getState`, `listTemplates`, `ping`.

## Publish over JSON-RPC

```bash
curl -s http://localhost:3847/rpc -H "Content-Type: application/json" -d "{
  \"jsonrpc\": \"2.0\",
  \"method\": \"renderComponent\",
  \"params\": {
    \"componentId\": \"product\",
    \"data\": {
      \"id\": \"item_55\",
      \"name\": \"Quantum Headphones\",
      \"price\": \"299.00\",
      \"description\": \"From the future\",
      \"finish\": \"Matte Black\"
    }
  },
  \"id\": 1
}"
```

The result includes both `html` (presentation) and `ldJson` (graph). Templates live in `templates/<name>.yml` and are selected by `componentId`. `renderInline` takes YAML in the request body instead; `params.item` chunks `map:` documents; `params.profile` filters `if:` / `flag:`.

## The reading room

[http://localhost:3847/live/](http://localhost:3847/live/) renders `.yml` sources live into a book spread — JSON-LD on the verso page, HTML on the recto. `hello.yml` tours the whole language in one file (keys, conventions, `ld_if`, profiles — switchable in the header); `exotic` is a field guide to exotic HTML5; `semantic-web` mocks up the Wikipedia article.

## Project map

| Path | Role |
|------|------|
| `src/parser/yamlDom.js` | YAML → HTML + ContentMap + LD harvest |
| `src/parser/conventions.js` | Class → vocabulary type conventions |
| `src/parser/ldResolver.js` | `{ ref }` + `ld_if` |
| `src/parser/keys.js` | `keys:` block + `{ key }` resolution |
| `src/parser/map.js` | `map:` composition documents |
| `src/parser/profiles.js` | `if:` / `flag:` profile filtering |
| `src/parser/includes.js` | `include:` partials + `file.yml#id` |
| `src/parser/validate.js` | strict-mode validation |
| `src/server/rpc.js` | JSON-RPC methods |
| `src/server/index.js` | HTTP + Socket.IO, `public/` + `/live/` mounts |
| `templates/` | Named components for RPC |
| `live/` | Reading room (book-spread demos) |
| `examples/` | Extension & customization walkthrough |
| `docs/` | DITA research notes |

Next: see [examples/README.md](examples/README.md) for copy-paste patterns to extend conventions, templates, and RPC.
