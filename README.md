# Twinseed

YAML structural markup that renders to HTML — and publishes **JSON-LD** from the same tree.

The web has always had two layers that rarely stay aligned: a **presentational tree** (what browsers paint) and a **knowledge graph** (what machines can interpret). Twinseed treats them as two faces of one leaf. You author an indentation-based structure; the runtime emits DOM for humans and linked data for the Semantic Web.

Optional JSON-RPC and WebSockets re-evaluate that pipeline when state changes, so presentation and assertions update together.

> One seed, two leaves.

## Features

**Language**

- **Twinseed markup** — keys are tags; indentation is the tree; `children:` for ordered siblings
- **Includes** — `include: "file.yml"` inlines a partial; `file.yml#id` pulls a single element (conref-lite), `include: { key: name }` makes it a conkeyref
- **Keys** — a `keys:` block binds symbolic names; `{ key: name }` resolves them in text, attributes, `ld:` values, and `include:` paths — late-bound from one place
- **Presentation profiles** — `if:` / `flag:` filter or mark content per render against an `audience` / `platform` / `product` profile; excluded content never asserts into the graph
- **Document heads** — `head:` blocks (`title`, `meta`, `link`, `css:`) fill the `<head>` of `--doc` output

**Linked data**

- **Linked data from structure** — `@context` (string, array, or map), `ld:` blocks, and class→vocabulary conventions
- **Reactive assertions** — `{ ref: "#id .class" }` binds graph properties to the same content the UI shows
- **Conditional assertions** — `ld_if` chooses types or properties from the data in the tree
- **YAML conventions** — declare class→type mappings in the file itself, with `extends:` single inheritance (`@type` union) and `requires:` strict-mode field checks
- **Graph identity** — `@id` on any element names its graph node; co-authored entities sharing an `@id` deep-merge, `@type`s union

**Composition**

- **Map documents** — a top-level `map:` composes fragments into a publication: nested `<section>`s, generated nav, related-links, prev/next pagers, and a `CollectionPage` node with `hasPart` — one structure, three projections
- **Knowledge feeds** — the same seed projects Atom / RSS (`--emit atom`, `GET /feed`) from TechArticle / DefinedTerm / HowTo-shaped graph nodes — a changelog/concept stream, not a product catalog
- **Knowledge watches** — session watches on ContentMap selectors (version, status, …) reuse `ld_if` conditions; Socket.IO emits `knowledgeAlert` when a condition edges true or a watched value changes

**Tooling**

- **CLI** — render, `--json`, `--doc`, `--watch`, `--strict`, `--profile`, `KEY=value` params, and `--emit resolved` to inspect the resolved intermediate tree
- **Live graph views** — JSON-RPC renders fragments and map sections; Socket.IO pushes HTML + JSON-LD on update (and `knowledgeAlert` for watches)
- **Reading room** — `/live/` serves book-spread demos rendered straight from `.yml` sources

## Quick start

```bash
npm install
npm start
```

Open [http://localhost:3847](http://localhost:3847) for the live demo: change state and watch the presentational tree and the JSON-LD graph update together. Then browse the reading room at [http://localhost:3847/live/](http://localhost:3847/live/).

```bash
# Render a file (HTML + linked data)
npm run render -- templates/demo.yml --json

# Compose a publication from fragments
node src/cli.js examples/14-map/site.map.yml --doc

# Inspect the resolved tree the renderer consumes
node src/cli.js examples/12-keys.yml --emit resolved

# Inject graph/entity data into placeholders
npm run render -- templates/product.yml --json \
  id=item_1 name="Widget" price=19.99 description="A thing" finish=Steel
```

Requires **Node.js 18+**.

Full walkthrough: [QUICKSTART.md](QUICKSTART.md)
Extend & customize: [examples/README.md](examples/README.md)
Design research (DITA → Twinseed): [docs/dita-research.md](docs/dita-research.md)

## Example

A presentational subtree that also asserts typed entities — with `keys:` binding names once and `{ key }` resolving them on both faces of the leaf (`https://schema.org` here — any JSON-LD `@context` fits the same pattern):

```yaml
"@context": "https://schema.org"

keys:
  product-name: "WonderWidget"                  # variable text
  support: { href: "https://example.com/support" }  # named link

div:
  class: "product"
  id: "item_1"

  ld:
    "@type": Product
    name: { key: product-name }
    offers:
      "@type": Offer
      price: { ref: "#item_1 .price" }
      priceCurrency: USD

  children:
    - h1: { class: "name", text: { key: product-name } }
    - span: { class: "price", text: "49.99" }
    - a: { href: { key: support }, text: "Support" }
```

The runtime renders the HTML card and a JSON-LD document: the `Product` entity from the convention, named by `{ key }`, priced by `{ ref }`. Presentation and graph share one tree — change the key once and both sides follow.

## Why this shape?

HTML alone is weak as a knowledge carrier. Separate RDF/JSON-LD files drift from the page. Twinseed keeps **structure, presentation, and assertion** in one authoring pass — closer to the Semantic Web’s original bet that the web of documents and the web of data should be the same web.

Crawlers and rich-result consumers are one audience for that graph. Agents, datasets, and interoperable APIs are others.

## JSON-RPC

Publish or refresh a fragment and its linked data:

```bash
curl -s http://localhost:3847/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "renderComponent",
    "params": {
      "componentId": "product",
      "data": {
        "id": "item_55",
        "name": "Quantum Headphones",
        "price": "299.00",
        "description": "From the future",
        "finish": "Matte Black"
      }
    },
    "id": 1
  }'
```

Methods: `renderComponent`, `renderDocument`, `renderInline`, `updateState`, `getState`, `listTemplates`, `ping`.

- `renderInline` renders YAML supplied in the request body — no `templates/` file needed.
- `params.item: "KEY"` on `renderComponent` / `renderInline` chunks a `map:` document into one section's HTML plus its slice of the graph.
- `params.profile: { "audience": "admin" }` filters `if:` / `flag:` for that render.

Templates are files in `templates/<name>.yml`, selected by `componentId`.

## The reading room — `/live/`

[http://localhost:3847/live/](http://localhost:3847/live/) is a small reading room: each leaf renders a `.yml` source live over RPC (`renderInline`) into a book spread — JSON-LD on the verso page, HTML on the recto, source in the colophon.

- **hello, world** — the full arc in one file: keys, YAML conventions with `extends:`, `ld:` / `ld_if`, and profiles (switch `audience=admin` / `audience=novice` in the header and watch both pages change)
- **exotic** — a field guide to HTML5's stranger elements, every one authored as a YAML key
- **wikipedia** — the Wikipedia “Semantic Web” article mocked up as one Twinseed tree, asserting its own article metadata

## Project layout

| Path | Role |
|------|------|
| `src/parser/` | YAML → HTML, ContentMap, JSON-LD resolution, vocabulary conventions |
| `src/parser/keys.js` | `keys:` block + `{ key }` resolution |
| `src/parser/map.js` | `map:` composition documents (sections, nav, pager, site graph) |
| `src/parser/feed.js` | Atom / RSS knowledge feed + backlinks from the JSON-LD / map graph |
| `src/parser/profiles.js` | `if:` / `flag:` profile filtering |
| `src/parser/includes.js` | `include:` partials and `file.yml#id` element pulls |
| `src/parser/validate.js` | strict-mode validation |
| `src/server/` | Express JSON-RPC + Socket.IO (live graph/presentation sync, knowledge watches) |
| `src/cli.js` | Offline render; `--emit resolved|atom|rss` |
| `templates/` | Named components for RPC |
| `public/` | Live demo client |
| `live/` | Reading room — book-spread demos and their `.yml` sources |
| `examples/` | Syntax and extension samples |
| `docs/` | Research notes (DITA concepts mapped onto Twinseed) |

## Extend

Bind a new presentational class to a vocabulary type, or add an RPC method that returns HTML + JSON-LD:

```js
import { registerConvention } from './src/parser/conventions.js';
import { registerMethod } from './src/server/rpc.js';

registerConvention('event', {
  type: 'Event',
  fields: { name: '.name', startDate: '.startDate', location: '.location' },
});

registerMethod('renderSnippet', (params) => { /* ... */ });
```

See [examples/README.md](examples/README.md) for runnable patterns.

## License

[MIT](LICENSE)
