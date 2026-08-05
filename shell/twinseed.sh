# Twinseed shell chrome + completion — bash and zsh
#
#   source /path/to/twinseed/shell/twinseed.sh
#   twinseed-use exemplar/templates/practice.skel.yml
#   twinseed-profile audience=admin
#   twinseed-prompt on
#
# Shared status:     node "$TWINSEED_SHELL/status.js" [--line|--color]
# Shared completion: node "$TWINSEED_SHELL/complete.js" --kind …
# Same nouns as PowerShell: seed, baseDir, profile, strict, ok/fail, dirty.

_twinseed_shell_dir() {
  # Resolve this file's directory (bash or zsh).
  if [ -n "${ZSH_VERSION:-}" ]; then
    # shellcheck disable=SC2296
    printf '%s' "${0:A:h}"
  elif [ -n "${BASH_SOURCE[0]:-}" ]; then
    cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
  else
    printf '%s' "$(cd "$(dirname "$0")" && pwd)"
  fi
}

# When sourced, BASH_SOURCE / zsh %x give the script path.
if [ -n "${ZSH_VERSION:-}" ]; then
  # shellcheck disable=SC2296
  TWINSEED_SHELL="$(cd "${${(%):-%x}:A:h}" && pwd)"
elif [ -n "${BASH_SOURCE[0]:-}" ]; then
  TWINSEED_SHELL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  TWINSEED_SHELL="$(_twinseed_shell_dir)"
fi
export TWINSEED_SHELL

_twinseed_node_status() {
  node "$TWINSEED_SHELL/status.js" "$@"
}

twinseed-status() {
  _twinseed_node_status
  printf '\n'
}

twinseed-status-line() {
  if [ "${1:-}" = '--color' ]; then
    _twinseed_node_status --color
  else
    _twinseed_node_status --line
  fi
}

twinseed-use() {
  if [ -z "${1:-}" ]; then
    echo "twinseed: usage: twinseed-use <seed.yml>" >&2
    return 1
  fi
  local seed
  seed="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  if [ ! -f "$seed" ]; then
    echo "twinseed: seed not found: $1" >&2
    return 1
  fi
  export TWINSEED_SEED="$seed"
  export TWINSEED_BASEDIR="$(dirname "$seed")"
  unset TWINSEED_LAST_RENDER TWINSEED_RENDER_AT
}

twinseed-basedir() {
  if [ -z "${1:-}" ]; then
    echo "twinseed: usage: twinseed-basedir <dir>" >&2
    return 1
  fi
  if [ ! -d "$1" ]; then
    echo "twinseed: baseDir not found: $1" >&2
    return 1
  fi
  export TWINSEED_BASEDIR="$(cd "$1" && pwd)"
}

twinseed-profile() {
  if [ "$#" -eq 0 ]; then
    unset TWINSEED_PROFILE
    return 0
  fi
  export TWINSEED_PROFILE="$*"
}

twinseed-strict() {
  case "${1:-}" in
    on|1|true|yes) export TWINSEED_STRICT=1 ;;
    off|0|false|no|'') unset TWINSEED_STRICT ;;
    *)
      echo "twinseed: usage: twinseed-strict on|off" >&2
      return 1
      ;;
  esac
}

twinseed-clear() {
  unset TWINSEED_SEED TWINSEED_BASEDIR TWINSEED_PROFILE TWINSEED_STRICT
  unset TWINSEED_LAST_RENDER TWINSEED_RENDER_AT TWINSEED_PROMPT
}

twinseed-mark() {
  case "${1:-}" in
    ok)
      export TWINSEED_LAST_RENDER=ok
      if [ -n "${TWINSEED_SEED:-}" ]; then
        local ms
        ms="$(_twinseed_node_status --stamp 2>/dev/null)" || ms=""
        [ -n "$ms" ] && export TWINSEED_RENDER_AT="$ms"
      fi
      ;;
    fail)
      export TWINSEED_LAST_RENDER=fail
      ;;
    *)
      echo "twinseed: usage: twinseed-mark ok|fail" >&2
      return 1
      ;;
  esac
}

twinseed-render() {
  local seed cli
  cli="$TWINSEED_SHELL/../src/cli.js"
  if [ $# -gt 0 ] && [ -f "$1" ]; then
    seed="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
    shift
  else
    seed="${TWINSEED_SEED:-}"
  fi
  if [ -z "$seed" ]; then
    echo "twinseed: no seed — twinseed-use <seed.yml> or pass a path" >&2
    return 1
  fi
  if ! node "$cli" "$seed" "$@"; then
    twinseed-mark fail
    return 1
  fi
  export TWINSEED_SEED="$seed"
  twinseed-mark ok
}

_twinseed_draw_prompt_line() {
  local line
  line="$(twinseed-status-line --color 2>/dev/null)" || return 0
  [ -n "$line" ] && printf '%s\n' "$line"
}

twinseed-prompt() {
  case "${1:-on}" in
    on|1|enable)
      export TWINSEED_PROMPT=1
      if [ -n "${ZSH_VERSION:-}" ]; then
        autoload -Uz add-zsh-hook 2>/dev/null || true
        add-zsh-hook -d precmd _twinseed_draw_prompt_line 2>/dev/null || true
        add-zsh-hook precmd _twinseed_draw_prompt_line
      else
        # bash: prepend once
        case "${PROMPT_COMMAND:-}" in
          *_twinseed_draw_prompt_line*) ;;
          '') PROMPT_COMMAND="_twinseed_draw_prompt_line" ;;
          *) PROMPT_COMMAND="_twinseed_draw_prompt_line; ${PROMPT_COMMAND}" ;;
        esac
      fi
      ;;
    off|0|disable)
      unset TWINSEED_PROMPT
      if [ -n "${ZSH_VERSION:-}" ]; then
        add-zsh-hook -d precmd _twinseed_draw_prompt_line 2>/dev/null || true
      else
        PROMPT_COMMAND="$(printf '%s' "${PROMPT_COMMAND:-}" | sed 's/_twinseed_draw_prompt_line; *//;s/; *_twinseed_draw_prompt_line//;s/^_twinseed_draw_prompt_line$//')"
      fi
      ;;
    *)
      echo "twinseed: usage: twinseed-prompt on|off" >&2
      return 1
      ;;
  esac
}

# --- completion (shared complete.js; sparse, quiet when unsure) ---

_twinseed_complete_lines() {
  # shellcheck disable=SC2086
  node "$TWINSEED_SHELL/complete.js" "$@" 2>/dev/null
}

_twinseed_compgen_from_kind() {
  local kind="$1"
  local cur="$2"
  shift 2
  local lines
  lines="$(_twinseed_complete_lines --kind "$kind" --word "$cur" "$@")"
  if [ -z "$lines" ]; then
    return 0
  fi
  if [ -n "${ZSH_VERSION:-}" ]; then
    # bashcompinit path: populate COMPREPLY
    # shellcheck disable=SC2207
    COMPREPLY=( $(compgen -W "$lines" -- "$cur") )
  else
    # shellcheck disable=SC2207
    COMPREPLY=( $(compgen -W "$lines" -- "$cur") )
  fi
}

_twinseed_complete_use() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  _twinseed_compgen_from_kind seeds "$cur"
}

_twinseed_complete_basedir() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  _twinseed_compgen_from_kind basedirs "$cur"
}

_twinseed_complete_profile() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  _twinseed_compgen_from_kind profile "$cur"
}

_twinseed_complete_strict() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  _twinseed_compgen_from_kind strict "$cur"
}

_twinseed_complete_mark() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  _twinseed_compgen_from_kind mark "$cur"
}

_twinseed_complete_prompt() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  _twinseed_compgen_from_kind prompt "$cur"
}

_twinseed_json_strings() {
  # Build a JSON string array without relying on node (package is ESM).
  printf '['
  local first=1 s
  for s in "$@"; do
    s=${s//\\/\\\\}
    s=${s//\"/\\\"}
    if [ "$first" -eq 1 ]; then
      first=0
    else
      printf ','
    fi
    printf '"%s"' "$s"
  done
  printf ']'
}

_twinseed_complete_render() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  local tokens=()
  local i
  # Words after the command name, excluding the word being completed.
  for ((i = 1; i < COMP_CWORD; i++)); do
    tokens+=("${COMP_WORDS[i]}")
  done
  local json
  json="$(_twinseed_json_strings "${tokens[@]}")"
  _twinseed_compgen_from_kind cli "$cur" --tokens "$json"
}

twinseed-completion() {
  case "${1:-on}" in
    on|1|enable|'')
      if [ -n "${ZSH_VERSION:-}" ]; then
        autoload -U +X bashcompinit 2>/dev/null && bashcompinit 2>/dev/null || true
      fi
      complete -o filenames -F _twinseed_complete_use twinseed-use 2>/dev/null || true
      complete -o filenames -F _twinseed_complete_basedir twinseed-basedir 2>/dev/null || true
      complete -F _twinseed_complete_profile twinseed-profile 2>/dev/null || true
      complete -F _twinseed_complete_strict twinseed-strict 2>/dev/null || true
      complete -F _twinseed_complete_mark twinseed-mark 2>/dev/null || true
      complete -F _twinseed_complete_prompt twinseed-prompt 2>/dev/null || true
      complete -o filenames -F _twinseed_complete_render twinseed-render 2>/dev/null || true
      ;;
    off|0|disable)
      complete -r twinseed-use twinseed-basedir twinseed-profile \
        twinseed-strict twinseed-mark twinseed-prompt twinseed-render 2>/dev/null || true
      ;;
    *)
      echo "twinseed: usage: twinseed-completion on|off" >&2
      return 1
      ;;
  esac
}

# Register when sourced (bash / zsh with bashcompinit).
twinseed-completion on

