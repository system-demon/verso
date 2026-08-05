# shell — Twinseed prompt chrome & completion

Session line above the prompt, plus Twinseed-aware tab completion. Shared by PowerShell, bash, and zsh.

**Not** a second canvas — chrome and completion are hands; the genome stays the source of truth. See `docs/u-ix-plan.md`.

## Prompt chrome

Sparse fragments, joined with ` · `:

| Fragment | Meaning |
|----------|---------|
| `ts` | Twinseed chrome is active |
| path or repo name | Active seed (relative to repo) or cwd repo basename |
| `base:…` | `TWINSEED_BASEDIR` when set explicitly beyond the seed’s dir |
| `audience=admin …` | Presentation profile |
| `strict` | `TWINSEED_STRICT` on |
| `ok` / `fail` | Last render via `Mark-TwinseedRender` / `twinseed-mark` |
| `dirty` | Seed mtime newer than last successful render stamp |

Example:

```
ts exemplar/templates/practice.skel.yml · audience=admin · strict · ok
```

Muted gray when `--color` / prompt mode is on. No emoji.

## Completion

One emitter: `shell/complete.js`. PowerShell uses `Register-ArgumentCompleter`; bash/zsh use `complete -F` (zsh via `bashcompinit`). Sparse and correct — quiet when unsure.

| Context | Candidates |
|---------|------------|
| Seed path (`Use-TwinseedSeed` / `twinseed-use`, render) | `*.skel.yml` and templates first, then examples (partials only if the word mentions them) |
| `Set-TwinseedBaseDir` / `twinseed-basedir` | Known include bases under the repo |
| Profile | `audience` / `platform` / `product` pairs (`audience=admin`, …) |
| Strict / mark / prompt | `on`\|`off`, `ok`\|`fail` |
| Render flags | `--json` `--doc` `--strict` `--watch` `--emit` `--profile` `--help` |
| After `--emit` | `resolved` |

```bash
node shell/complete.js --kind seeds --word exemplar
node shell/complete.js --kind profile --word audience
node shell/complete.js --kind cli --word -- --tokens '["--emit"]'
node shell/complete.js --surface   # JSON vocab
```

Completers register when you import/source the shell helpers.

## Enable — PowerShell

From the repo root (or any path to the module):

```powershell
Import-Module .\shell\twinseed.psm1 -DisableNameChecking
Enable-TwinseedPrompt

Use-TwinseedSeed .\exemplar\templates\practice.skel.yml
Set-TwinseedProfile audience=admin
Set-TwinseedStrict on
Invoke-TwinseedRender --json   # stamps ok/fail
```

Tab-complete seeds, profile pairs, and render flags on the helpers above.

Persist in `$PROFILE`:

```powershell
Import-Module X:\twinseed\shell\twinseed.psm1 -DisableNameChecking
Enable-TwinseedPrompt
```

Helpers: `Use-TwinseedSeed`, `Set-TwinseedBaseDir`, `Set-TwinseedProfile`, `Set-TwinseedStrict`, `Mark-TwinseedRender -Ok|-Fail`, `Clear-TwinseedSession`, `Disable-TwinseedPrompt`, `Register-TwinseedCompleters`.

## Enable — bash

```bash
source /path/to/twinseed/shell/twinseed.sh
twinseed-prompt on

twinseed-use exemplar/templates/practice.skel.yml
twinseed-profile audience=admin
twinseed-strict on
twinseed-render --json   # or twinseed-render path/to.yml --json
```

Completion is on by default (`twinseed-completion on|off`).

Persist in `~/.bashrc`:

```bash
source /path/to/twinseed/shell/twinseed.sh
twinseed-prompt on
```

## Enable — zsh

Same script; `precmd` hook instead of `PROMPT_COMMAND`. Completion uses `bashcompinit`.

```zsh
source /path/to/twinseed/shell/twinseed.sh
twinseed-prompt on
```

Persist in `~/.zshrc` the same way.

## Shared emitters

```bash
node shell/status.js          # JSON
node shell/status.js --line   # prompt fragment
node shell/status.js --color  # muted ANSI line
node shell/status.js --stamp  # seed mtime ms (for render stamp)

node shell/complete.js --kind seeds|flags|profile|emit|basedirs|strict|mark|prompt|cli
```

Session env (set by the helpers above):

- `TWINSEED_SEED` — absolute path to the active genome
- `TWINSEED_BASEDIR` — include base
- `TWINSEED_PROFILE` — space-separated `key=value` pairs
- `TWINSEED_STRICT` — `1` when strict
- `TWINSEED_LAST_RENDER` — `ok` | `fail`
- `TWINSEED_RENDER_AT` — seed mtime (ms) at last successful render
