# Twinseed shell chrome — bash and zsh
#
#   source /path/to/twinseed/shell/twinseed.sh
#   twinseed-use exemplar/templates/practice.skel.yml
#   twinseed-profile audience=admin
#   twinseed-prompt on
#
# Shared status: node "$TWINSEED_SHELL/status.js" [--line|--color]
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
    echo "twinseed: usage: twinseed-use <file.yml>" >&2
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
    echo "twinseed: no seed — twinseed-use <file.yml> or pass a path" >&2
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
