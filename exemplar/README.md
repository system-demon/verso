# exemplar — a scratchpad

Your practice space for the Twinseed flow. Nothing here ships; play freely.
Typed as **PracticeCanvas** against a local vocabulary — not Schema.org commerce types.

One seed, two leaves — and a genetics reading of the same idea. The YAML is the **genome** (the complete specification). From it grow two leaves: the **phenotype** (HTML, for humans) and the **genotype** (JSON-LD / diagram, machine-readable identity). Profiles and `if:`/`flag:` filters are regulatory switches — same genome, different expression.

## What's here

| Path | What |
|------|------|
| `canvas.html` | The live canvas: genome (YAML) in; phenotype (preview / CSS tabs) + genotype out |
| `quickref.html` / `quickref.yml` | Field guide (dialogs, description, sortable tables, map/area…) |
| `schema.jsonld` | Local JSON-LD vocabulary (`PracticeCanvas`, `Skeleton`, fields) |
| `blank.css` | A blank practice stylesheet (tokens + comments only) |
| `templates/*.skel.yml` | Skeletal starting points — copy one, fill the «slots» |

## The flow

1. Start the server (`npm start`), open [http://localhost:3847/exemplar/canvas.html](http://localhost:3847/exemplar/canvas.html).
2. Skim the [quickref](http://localhost:3847/exemplar/quickref.html) for dialogs, description lists, sortable tables, and image maps.
3. Pick a skeleton with **load skeleton** (or write YAML cold in the manuscript).
4. Edit — the phenotype (recto) re-renders on a 300ms debounce; the genotype (verso) shows the graph your structure asserts (JSON-LD or diagram).
5. Style it via the phenotype **css** tab — applies to the preview instantly, no server round-trip.
6. Try the profile buttons (`audience=admin` / `novice`) to see `if:`/`flag:` filtering live.

## Local type

Documents point at `/exemplar/schema.jsonld` and assert `PracticeCanvas` (or `Skeleton`) via `ld:` / YAML `conventions:`. Fields: `name`, `description`, `purpose`, `author`, `status`, `relatedDocs`, `skeletons`, `focus`. Prefer this framing over Product/Offer-style examples while practicing here.

## The skeletons

- **practice.skel.yml** — HTML5 playground (dialog, dl, sortable table, map/area, mark/time/meter/picture…) typed as PracticeCanvas
- **card.skel.yml** — convention class + `{ ref }` / `{ key }` bindings on PracticeCanvas fields
- **page.skel.yml** — `head:` block + sections (try `--doc` from the CLI)
- **entity.skel.yml** — keys, a YAML-declared convention, `ld_if` conditional status
- **map.skel.yml** — composition over fragment files (`intro.yml`, `next.yml`, `deep.yml` are included and ready to edit). The canvas passes a repo-clamped `baseDir` so maps render inline; from the CLI it resolves relative to the map file.

## Beyond the canvas

```bash
# render a file from the CLI
npm run render -- exemplar/templates/card.skel.yml --json

# see exactly what the renderer consumes
npm run render -- exemplar/templates/card.skel.yml --emit resolved
```
