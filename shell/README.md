# shell — Twinseed prompt chrome

Prototype status line for the Twinseed session: active genome, profile, strictness, last render, genome dirty when stamped.

**Not** completion yet — that is phase 2 (`docs/u-ix-plan.md`).

PowerShell, bash, and zsh share `status.js`. Same metaphor on every shell.

## What the line shows

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

Persist in `$PROFILE`:

```powershell
Import-Module X:\twinseed\shell\twinseed.psm1 -DisableNameChecking
Enable-TwinseedPrompt
```

Helpers: `Use-TwinseedSeed`, `Set-TwinseedBaseDir`, `Set-TwinseedProfile`, `Set-TwinseedStrict`, `Mark-TwinseedRender -Ok|-Fail`, `Clear-TwinseedSession`, `Disable-TwinseedPrompt`.

## Enable — bash

```bash
source /path/to/twinseed/shell/twinseed.sh
twinseed-prompt on

twinseed-use exemplar/templates/practice.skel.yml
twinseed-profile audience=admin
twinseed-strict on
twinseed-render --json   # or twinseed-render path/to.yml --json
```

Persist in `~/.bashrc`:

```bash
source /path/to/twinseed/shell/twinseed.sh
twinseed-prompt on
```

## Enable — zsh

Same script; `precmd` hook instead of `PROMPT_COMMAND`:

```zsh
source /path/to/twinseed/shell/twinseed.sh
twinseed-prompt on
```

Persist in `~/.zshrc` the same way.

## Shared emitter

```bash
node shell/status.js          # JSON
node shell/status.js --line   # prompt fragment
node shell/status.js --color  # muted ANSI line
node shell/status.js --stamp  # seed mtime ms (for render stamp)
```

Session env (set by the helpers above):

- `TWINSEED_SEED` — absolute path to the active genome
- `TWINSEED_BASEDIR` — include base
- `TWINSEED_PROFILE` — space-separated `key=value` pairs
- `TWINSEED_STRICT` — `1` when strict
- `TWINSEED_LAST_RENDER` — `ok` | `fail`
- `TWINSEED_RENDER_AT` — seed mtime (ms) at last successful render
