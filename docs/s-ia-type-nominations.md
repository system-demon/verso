# s-ia — type nominations (PlantUML JSON diagram family)

Propose a focused Twinseed type family so genotype → `@startjson` is **structured assertion**, not a pretty-print of `ldJson`.

Sources: [PlantUML JSON](https://plantuml.com/json), Twinseed `src/server/diagram.js`, conventions / exemplar vocabulary, thrust in `docs/s-ia.md`.

---

## Gap (why nominate anything)

| Layer today | What happens |
|---|---|
| **Types** | Content conventions (`Product`/`PracticeCanvas`/…) plus IA vocab at `/ia/schema.jsonld` for diagram annotation. |
| **Diagram emit** | `jsonDiagramText` sanitizes paths, strips `DiagramHighlight` / `DiagramFocusSet` / `diagramFocus`, expands `"*"` path segments, emits `#highlight … <<Role>>`, paper-skins the rest into `@startjson`. |
| **Still unused** | Array-as-table vs empty `[]`/`{}`, Creole in leaf strings, per-arrow style. |

Skinparams already cover **chrome**. Nominations below name **meaning** the emitter can turn into those moves.

---

## PlantUML JSON vocabulary → Twinseed mapping

| PlantUML concept | Diagram surface | Earn a Twinseed type? |
|---|---|---|
| Object / nesting | Boxes + arrows (automatic) | No new type — ordinary JSON-LD objects / `@id` nodes |
| `#highlight` + path | Focal key/value cells | **Yes** — assert focus, don’t bury it in emit-only flags |
| Path `/` + array indices | Address into nest/list | **Yes** as datatype/property, not a free-floating class zoo |
| Path segment `"*"` | Fan-out across children | **Yes** — segment on `highlightPath` (quote in YAML) |
| `<<stereotype>>` on highlight | Typed highlight roles (`.h1` / `.ok`) | **Yes** — roles carry meaning across genotypes |
| Bundle of highlights | Document-level focus | **Yes** — `DiagramFocusSet` / root `diagramFocus` |
| `jsonDiagram { node, separator, arrow, highlight }` | Global style | **No** — stay skin / theme (thrust: IA before chrome) |
| Arrays as tables | Row/column layout | **Maybe** — only if we need “this collection is tabular in the diagram” beyond `@list` |
| `null` / empty `[]` `{}` | Distinct empty glyphs | **Maybe** — only if we must *preserve* absence Twinseed currently drops |
| Creole / HTML Creole in strings | Leaf typography | Defer — presentation leak into genotype |
| Per-arrow style | Forum: mostly global | Defer — no reliable first-class arrow target |
| JSON embed in UML (class/deploy/state) | Other diagram kinds | Out of `@startjson` genotype path for now |

---

## Nomination shortlist

Namespace (locked): `https://twinseed.local/ia#` → `/ia/schema.jsonld`.

### P1 — register first

| Type / term | Kind | PlantUML map | Why it earns a slot |
|---|---|---|---|
| **`DiagramHighlight`** | Class | One `#highlight …` directive | Focal paths are assertions (“this field is the point”), not emit cosmetics. Without it, diagrams stay undifferentiated dumps. |
| **`highlightPath`** | Property (range: path datatype) | `"key" / "nested" / "0"` segments | Shared addressing for highlights (and wildcards). Prefer one path type over inventing Node/Arrow classes for automatic layout. |
| **`HighlightRole`** | Class *or* controlled vocabulary | `<<role>>` + `.role { … }` style class | Different highlights mean different things (focus vs warning vs status). Stereotypes are the only first-class *typed* highlight channel PlantUML exposes. |

**Suggested shape (illustrative):**

```json
{
  "@type": "DiagramHighlight",
  "highlightPath": ["@graph", "0", "status"],
  "role": { "@id": "ia:Focus" }
}
```

**Registered (P1):** vocab at `/ia/schema.jsonld` (`https://twinseed.local/ia#`). Emitter in `src/server/diagram.js` collects `DiagramHighlight` nodes, emits `#highlight` lines *above* the JSON body, strips those nodes from the stringify body, and skins `.Focus` / `.Warning` / `.StatusOk` / `.StatusBad` in the paper theme. Exemplar: `exemplar/templates/diagram-focus.skel.yml`.

**Minimal role seeds (P1 vocabulary, not infinite):** `Focus`, `Warning`, `StatusOk`, `StatusBad` — enough to exercise stereotype classes; expand only when a genotype needs a new meaning.

### Registered next (FocusSet + wildcards)

| Type / term | Kind | PlantUML map | Why |
|---|---|---|---|
| **`DiagramFocusSet`** | Class | Bundle → N `#highlight` lines | One root node listing highlights for a genotype, instead of scattering peer `DiagramHighlight` entities. Property: `highlights` (list). Optional root sugar: `diagramFocus`. |
| **`"*"` path segment** | Syntax on `highlightPath` | Fan-out highlights | Matches every object key or array index at that depth. Emitter expands against the stripped body into concrete `#highlight` lines (PlantUML JSON docs only show exact paths; expansion keeps emission portable). |

**FocusSet shape:**

```json
{
  "@type": "DiagramFocusSet",
  "highlights": [
    {
      "@type": "DiagramHighlight",
      "highlightPath": ["@graph", "*", "status"],
      "role": "Focus"
    },
    {
      "@type": "DiagramHighlight",
      "highlightPath": ["@graph", "0", "purpose"],
      "role": "Warning"
    }
  ]
}
```

### P2 — register when absence / table semantics bite

| Type / term | Kind | PlantUML map | Why (conditional) |
|---|---|---|---|
| **`ExplicitNull`** (or property `explicitNull: true` on a typed slot) | Class or flag | JSON `null` leaf | Twinseed often omits empty fields; PlantUML *draws* null. Nominate only if “unknown / deliberately absent” must survive into the genotype diagram. |
| **`TabularCollection`** | Class (or stereotype on `@list`) | Root/array rendered as table | Arrays already draw as tables; earn a type only when authors must *choose* table vs nested-object presentation for the same data. Prefer a role/stereotype on existing lists over a parallel collection ontology. |

### P3 — defer (do not register yet)

| Candidate | Reason to wait |
|---|---|
| `JsonNode` / `JsonArrow` / `Separator` | Layout chrome PlantUML derives from structure/style; naming them duplicates the renderer |
| `CreoleLiteral` / annotated strings | Blurs genotype honesty with diagram typography; use highlight roles or phenotype CSS instead |
| `JsonEmbed` (UML-mixed JSON) | Different diagram family; not the verso `@startjson` path |
| `**` / multi-hop wildcards as their own type | Stick to single-segment `"*"` until a genotype needs deeper fan-out |
| Per-edge arrow assertions | PlantUML JSON still treats arrows as mostly global style |

---

## Priority rationale (focused set)

1. **P1 trio** unlocks the only PlantUML moves Twinseed never emits today: path-addressed highlight + typed stereotype. Small surface, high illustrative leverage.
2. **FocusSet + `"*"`** are thin sugar on that surface — bundling and fan-out without new diagram chrome.
3. **P2** only if real genotypes need preserved nulls or explicit table intent — avoid parallel type systems for JSON’s native shapes.
4. **P3** stays out so the family doesn’t become a mirror of the style tree.

Out of scope for this nomination: changing `u-ix` work, or replacing Schema.org / exemplar content types (`PracticeCanvas`, etc.). Those remain content vocabulary; s-ia types are **diagrammatic annotation** layered on the genotype.

---

## Decisions

1. **Namespace & home** — separate `ia` vocab at `https://twinseed.local/ia#`, served as `/ia/schema.jsonld` (not folded into exemplar content types).
2. **Where highlights live** — `DiagramHighlight` peer entities, and/or a `DiagramFocusSet` (or root `diagramFocus`) that owns a `highlights` list.
3. **Roles** — short tokens (`Focus`) or IRIs (`ia:Focus` / full `#` IRI); emitter maps both to `<<Focus>>`.
4. **Null policy** — unchanged; `ExplicitNull` remains P2.
5. **Emitter contract** — strip `DiagramHighlight` / `DiagramFocusSet` / `diagramFocus` from the JSON body; emit only as `#highlight` lines. Paper theme + role stereotype skins unchanged.
6. **Wildcards** — `"*"` is one-hop fan-out; emitter expands against the stripped body into concrete paths (no bare `"*"` left in emitted UML). Exact paths still emit even if the cell is missing; wildcard with zero matches emits nothing. **YAML authors must quote `"*"`** — a bare `*` is a YAML alias indicator. PlantUML also accepts `"*"` natively; Twinseed’s fan-out is the portable projection.

---

## Suggested next steps

1. ~~Lock namespace + P1 names.~~
2. ~~Add JSON-LD fragment under `ia/`.~~
3. ~~Teach `jsonDiagramText` to emit `#highlight` / `<<role>>`; skin role colors.~~
4. ~~Exemplar genotype (`diagram-focus.skel.yml`).~~
5. ~~Register `DiagramFocusSet` + `"*"` expansion.~~
6. Revisit remaining P2 only after that loop feels honest in real canvases.
