# Examples: extend & customize

Each example is runnable. YAML files use the CLI; `.js` files register extensions then render.

```bash
# From repo root
npm run render -- examples/01-basic.yml --json
node examples/05-register-convention.js
node examples/06-custom-rpc.js
```

These samples show how **Twinseed** grows the **presentational tree** and the **linked-data graph** together — not as separate authoring passes.

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

## 11. Keys — `12-keys.yml`

A top-level `keys:` block binds symbolic names, and `{ key: name }` resolves them anywhere a value appears — variable text, named selectors, links, and include resources, all late-bound from one place:

```yaml
keys:
  product-name: "WonderWidget"                  # literal text
  price: { ref: "#item_1 .price" }              # named selector alias
  support: { href: "https://example.com/support" }  # named link
  logo: "partials/logo.yml"                     # named include resource
```

```bash
npm run render -- examples/12-keys.yml --json
```

Resolution rules:

- `{ key }` works in `ld:`/`ld_if` values, attributes (`href:`, `src:`, …), `text:`, and `include:`.
- Literal and `{ href }` keys substitute pre-render (same phase as `{{params}}`, which they complement rather than replace — params do not override keys).
- `{ ref }`-valued keys resolve post-render against the ContentMap, so they are allowed **only** in `ld:`/`ld_if` values; the emitted graph is identical to writing the `{ ref }` by hand.
- `include: { key: logo }` resolves the key's path value and inlines the partial (cycle protection applies). Include keys must be path strings, and an undefined include key fails fast in both modes — includes are structural. The path may carry `#id` to pull one element out of the partial (conkeyref — see section 14).
- Keys cascade down the include chain: an including file's `keys:` are visible inside partials, and the first definition wins (a partial cannot shadow its parent).

**Strict mode:** an unknown `{ key }` name is a validation error, and a ref-valued key whose selector is absent from the ContentMap after render errors too (lenient mode resolves to `null`, like `{ ref }` today).

---

## 12. Convention `extends:` + `requires:` — `13-extends.yml`

Conventions can be declared in YAML (not just JS) via a top-level `conventions:` block, with single inheritance:

```yaml
conventions:
  vehicle:
    extends: product        # inherits .name / .description / .price fields
    type: Vehicle
    fields: { sku: ".sku" } # child fields override/extend the parent's
    requires: [.name, .sku] # strict-mode content contract
```

```bash
npm run render -- examples/13-extends.yml --json
```

Semantics:

- **Fields** merge child-over-parent; **`@type` unions** ancestor-first — `vehicle:` emits `"@type": ["Product", "Vehicle"]`. A child that omits `type` inherits the parent's alone. Product/Review conveniences (Offer/Rating nesting) apply to descendants too.
- **Transforms** (JS-registered only) chain parent-first. YAML declarations support `type` / `fields` / `extends` / `requires` only.
- **Entity shorthand** works for YAML conventions: `vehicle:` becomes `<div class="vehicle">`. When an element matches both an ancestor and a descendant convention, only the most specific emits an entity.
- **`requires:`** turns typing into a `--strict` check: after render, every element matching the convention must have each selector in the ContentMap scoped to its id (e.g. `#car_7 .sku`), or validation errors. Lenient mode renders regardless.
- Declarations merge into a per-render registry (the global `ConventionRegistry` is never mutated); a YAML declaration wins over a same-named built-in, and file-root blocks in partials merge the same way keys do. Strict mode validates the block itself: `extends` targets must exist, `fields` must map strings to strings.

---

## 13. Maps — `examples/14-map/`

A top-level `map:` key makes the file a **composition document**: it owns publication structure (order, nav, relations, pagination) while fragments — ordinary Twinseed files — own content. One structure, three projections: an HTML document, a nav tree, and a site-level knowledge graph.

```yaml
"@context": "https://schema.org"
map:
  title: "WonderWidget Docs"
  ld: { "@type": CollectionPage }        # the publication node
  keys: { product-name: "WonderWidget" } # cascades into all fragments
  items:
    - key: intro
      include: "intro.yml"               # relative to the map file
      nav: "Introduction"
    - key: pricing
      include: "pricing.yml"
      nav: "Pricing"
      items:                             # nesting = nested sections
        - { key: tiers, include: "tiers.yml", nav: "Tiers" }
  relations:
    - [intro, pricing]                   # undirected related-links pair
```

```bash
node src/cli.js examples/14-map/site.map.yml --doc
```

Semantics:

- **Sections.** Each item renders its fragment through the existing include machinery (cycle protection applies; paths resolve relative to the map file, fragment-relative for nested includes) and is wrapped in `<section id="KEY">`. Items must have a unique `key:`; an item may carry `include:`, nested `items:`, or both (the fragment renders first, children nest inside its section).
- **Nav.** The document opens with a `<nav>` whose nested `<ul>` mirrors the items tree, linking `#KEY` anchors; items without `nav:` use their key as link text.
- **Cascade.** Map-level `keys:` and `conventions:` are visible inside every fragment, and the map wins name conflicts (first-definition-wins, like include chains). The document `@context` merges with each fragment's own (deduped). `head:` does **not** cascade — only the map's own `head:` reaches `--doc` output; fragment `head:` blocks are dropped.
- **Relations.** Each `[a, b]` pair appends a "Related" link list (`<nav class="verso-related">`) to both sections and adds `isRelatedTo` (`{ "@id": "#KEY" }` refs) to their graph nodes via the existing @id merge.
- **Order → pager.** Item order is meaningful: every top-level section gets a `<nav class="verso-pager">` footer with `rel="prev"` / `rel="next"` links. Nested items participate in their parent's sequence only (no pager of their own).
- **Graph.** The map's `ld:` describes the publication node — `{ "@type": CollectionPage }` plus `hasPart` listing every section `@id` in document order. Each section keeps a fragment-stable `@id`: author the fragment's root `ld:` with `"@id": "#KEY"` (see `intro.yml`) and it names the same node whether the fragment renders standalone or inside the map.
- **Chunking (RPC).** `renderComponent` / `renderInline` accept `params.item: "KEY"` — when the source is a map, the response is just that section's HTML plus a `ldJson` holding the publication node and that section's node, not the whole graph. Omit `item` for the full map.
- **Liveness (deferred design fork).** No fragment-granular push: a fragment change re-renders and pushes the **whole map** — the map is the update unit. Section-granular patches ride on `params.item` chunking later, if profiling ever demands it (mirrors open question 1 in `docs/dita-research.md`).

**Strict mode:** the map must be a mapping with a list `items:`; every item needs a unique `key` and an `include` and/or nested `items`; `nav` must be a string; `relations` entries must be pairs of known keys. Lenient mode keeps rendering with fallbacks (`item-N` keys, `-2` suffixes, skipped relations). One caveat: detection is the top-level `map:` key itself, so a document whose root element is an HTML `<map>` tag now routes to map rendering — nest `<map>` under another element if you ever need the tag.

---

## 14. Element-level includes (`file.yml#id`) — `15-include-id.yml`

Where `include: "partials/legal.yml"` inlines a whole file (see `10-include.yml`), a path may carry a **fragment** to pull just one element out of a partial — conref-lite:

```yaml
footer:
  include: "partials/legal.yml#copyright"   # the element whose id: is "copyright"
  class: "site-footer"
```

```bash
npm run render -- examples/15-include-id.yml
```

Semantics:

- **`#id` selects one element** from the partial's *resolved* tree — the partial's own nested includes are processed first, so ids inside deeper partials are addressable. The id addressed is the element's `id:` attribute value.
- **The pulled element keeps its own tag.** The including key (`footer:` above) is dropped; the element renders under whatever tag it was defined with in the partial. Two pulls whose elements share a tag need a `children:` list (YAML maps can't repeat keys — the same rule as everywhere else).
- **The including node's other keys merge over the pulled body**, exactly like whole-file map partials: local keys win (`id:`, `text:`, `children:`, …) and author classes from both sides union, deduped — `class: "site-footer"` above yields `class="legal site-footer"`.
- **Conkeyref:** `include: { key: name }` where the key's value carries `#id` resolves the key first, then applies the same fragment logic — one symbolic name per reusable element.
- **Errors are structural** (both modes, like missing files): an unknown id names the file, the id, and the ids the partial declares; `file.yml#` (empty fragment) and `#id` (no file path) fail fast. Cycle/depth rules are unchanged — the cycle key is the resolved file path; the `#id` part is stripped before resolution.
- **Deferred:** conref push (`conaction`), `conrefend` ranges, and validity lattices are explicit non-goals (`docs/dita-research.md` P5).

---

## 15. Profiles — `16-profiles.yml`

`if:` / `flag:` are **presentation-side** conditionality (ditaval-lite): they answer "who is this rendering for?" against a per-render **profile** — a different axis from `ld_if` (example 4), which is graph-side and reads the ContentMap *after* render.

```yaml
div:
  class: "admin-panel"
  if: { audience: admin }          # rendered only when the profile has audience=admin

p:
  if: "platform == 'web'"          # string form: <attribute> ==|!= 'value' (quotes optional)

span:
  text: "New in 2.0"
  flag: { audience: novice }       # always kept; gains class flag-novice when it matches
```

```bash
node src/cli.js examples/16-profiles.yml --profile audience=admin platform=web
```

Supplying a profile:

- **CLI:** `--profile audience=admin platform=web` — key=value pairs collected after the flag until the next `--flag`. A separate channel from `{{params}}` pairs (they never mix).
- **RPC:** `params.profile` object (`{ "audience": "admin" }`) on `renderComponent`, `renderDocument`, `renderInline`, `updateState`; the normalized profile is echoed in the result when supplied.
- **JS:** `renderYaml(source, { profile: { audience: 'admin' } })`.

Semantics:

- **Phase.** Conditions evaluate **before** include/`{{params}}`/`{ key }` resolution — the first step after YAML parse. Excluded content never enters the tree: it never renders and never asserts into the graph (an `ld:` block on a filtered-out element vanishes from `ldJson` — compare the profiles in example 16). Consequence: conditions can reference the **profile only**, never ContentMap values — unlike `ld_if`, which evaluates post-render.
- **Default-include.** No profile supplied → everything renders, unflagged (filtering is opt-in per render). A supplied-but-empty profile excludes every `if:`.
- **Object form** is AND: every key must equal the profile value (string equality). **String form** supports `==` and `!=` only — left side a profiling attribute, right side a quoted or bare string (no numeric operators, no ContentMap selectors). A profile attribute that is absent compares as missing: `==` fails, `!=` holds.
- **`flag:`** never excludes. When the whole condition matches, the element gains one `flag-<value>` class per condition pair (string form: the right-hand side) — `flag: { audience: novice, platform: web }` adds `flag-novice flag-web`, but only when both match.
- **Fixed vocabulary:** `audience`, `platform`, `product` only (for profiles and conditions alike; unknown keys in a supplied profile are a caller error).
- **Include boundary:** in standalone files the filter runs before `include:` resolves, so gate includes with `if:` at the include site rather than authoring conditions inside partials (partials' own conditions are honored when rendered through a `map:` document, where filtering runs over the assembled tree).

**Strict mode:** every `if:`/`flag:` must be a non-empty map using only `audience`/`platform`/`product` keys with string values, or a valid string condition — checked whenever strict is on, with or without a profile. Unknown vocabulary keys, empty maps, and malformed strings are validation errors naming the path. **Lenient mode** treats malformed conditions as non-matching: excluded for `if:`, unflagged for `flag:`.

---

## 16. Debug target: `--emit resolved`

`--emit resolved` prints the **resolved intermediate tree** — the document exactly as the renderer consumes it — serialized back to YAML, instead of rendering HTML. This is tooling pattern #1 from `docs/dita-research.md` ("normalize-then-emit with a documented intermediate + debug target"): the same idea as DITA-OT's preprocess/`dita` transtype or mdBook's debug renderer. Use it to debug includes, profiles, params, and keys — or to pipe the normalized tree into other tooling.

```bash
node src/cli.js examples/12-keys.yml --emit resolved
```

```yaml
div:
  class: product
  id: item_1
  ld:
    '@type': Product
    name: WonderWidget            # { key: product-name } substituted
    offers:
      '@type': Offer
      price:
        ref: '#item_1 .price'     # ref-valued key rewritten to { ref }
  children:
    - h1: { class: name, text: WonderWidget }
    # ...
```

What you get, and why:

- **Exactly the renderer's input.** The emitted tree is the first argument `renderTree` receives: includes inlined (fragment pulls applied), profile filtering done (`if:`/`flag:` keys stripped, failed conditions pruned), `{{params}}` injected, `{ key }` references substituted. `KEY=value` params and `--profile` apply — e.g. `--emit resolved --profile audience=novice` on `16-profiles.yml` emits a tree with the admin panel absent and `flag-novice` classes already merged.
- **Maps emit the assembled synthetic tree.** For a `map:` document you get the `{ fragment: [nav, section…] }` tree after assembly: nav/pager/related-link nodes generated, fragments included, map-level key/convention cascades applied. (The publication-level root JSON-LD — `CollectionPage` + `hasPart` — is computed alongside the tree and passed to the renderer separately, so it is not in the output.)
- **Harvested blocks are stripped.** File-root `keys:` / `conventions:` blocks are collected into the per-render key map and convention registry during include resolution — they never reach the renderer, so they never reach the emitted tree either. (Conventions therefore still affect the *render* of an emitted tree via the registry; they just aren't data in it.) Likewise, map fragments' `head:`/`@context` are consumed by the cascade and don't appear.
- **Ref-valued keys stay as `{ ref }`.** They resolve post-render against the ContentMap, so the emitted tree shows them in their rewritten `{ ref: "selector" }` form inside `ld:`/`ld_if`.
- **`--strict` still validates.** `--strict --emit resolved` runs the same tree validation and exits non-zero on the same errors a render would.
- **Mutually exclusive with `--json` / `--doc`** (a clear error — there is no HTML or JSON-LD to print). Pairs with `--profile`, `KEY=value`, and `--watch` (re-emits on change, handy for watching a tree normalize).

The JS-side entry point is `resolveTree(source, options)` in `src/parser/yamlDom.js`, which shares the render pipeline with `renderYaml` up to (but not including) the render pass.

---

## Extension checklist

| Goal | Where |
|------|--------|
| New page/component markup | `templates/*.yml` or `examples/*.yml` |
| New vocabulary type from classes | `registerConvention(...)` or a YAML `conventions:` block |
| Specialize a convention / type union | `extends:` in a `conventions:` block |
| Enforce a convention's fields | `requires:` + `--strict` |
| Variable text / named links / named partials | `keys:` block + `{ key: name }` |
| Reuse one element from a partial (conref-lite) | `include: "file.yml#id"` or a key carrying `#id` |
| Compose a publication (nav, related links, pager, site graph) | `map:` document — `examples/14-map/` |
| Conditional assertions | `ld_if` in the YAML |
| Bind graph properties to UI text | `ld:` + `{ ref }` (or a ref-valued `{ key }`) |
| New remote publish API | `registerMethod(...)` in RPC |
| Real-time push of view + graph | `src/server/index.js` `pushUpdate` emit |
| Parser / attribute rules | `ATTR_KEYS` / `TEXT_KEYS` in `yamlDom.js` |
| Debug the tree the renderer receives | `--emit resolved` (`resolveTree()` in `yamlDom.js`) |

When in doubt: start from a YAML example, render with `--json`, inspect `html` + `ldJson` + `contentMap`, then add a convention or RPC method only if the markup alone is not enough.
