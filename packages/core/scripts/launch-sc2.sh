#!/usr/bin/env bash
# Launch StarCraft II straight into a map, the way the Editor's Test Document does.
#
#   packages/core/scripts/launch-sc2.sh <map.SC2Map> [--replace] [-- <extra SC2 args>]
#   packages/core/scripts/launch-sc2.sh --logs     # print the newest game session's script errors/text
#
# The map (unpacked folder or packed file) is copied to Maps/Test/sc2-adjutant/ because
# SC2 resolves -run paths relative to its Maps directory.
set -euo pipefail

SC2_ROOT="${SC2_ROOT:-/Applications/StarCraft II}"
LOG_DIR="$HOME/Library/Application Support/Blizzard/StarCraft II/GameLogs"
TEST_SUBDIR="Test/sc2-adjutant"

newest_session() {
  # Every file of one game session shares a "YYYY-MM-DD HH.MM.SS" prefix; ScriptError marks a game run.
  ls "$LOG_DIR" 2>/dev/null | grep ' ScriptError.txt$' | sort | tail -1 | sed 's/ ScriptError.txt$//'
}

print_logs() {
  local session="${1:-$(newest_session)}"
  [[ -n "$session" ]] || { echo "No game logs in $LOG_DIR" >&2; exit 1; }
  echo "Session: $session"
  for kind in ScriptError Text; do
    local f="$LOG_DIR/$session $kind.txt"
    [[ -f "$f" ]] || continue
    echo "----- $kind.txt -----"
    # Skip the environment header block that opens each file.
    awk '/^<AgentVersion>/{body=1; next} body' "$f"
  done
}

if [[ "${1:-}" == "--logs" ]]; then
  print_logs
  exit 0
fi

map="${1:-}"
[[ -n "$map" && -e "$map" ]] || { echo "usage: $0 <map.SC2Map> [--replace] [-- <extra SC2 args>]" >&2; exit 2; }
shift
replace=0
extra=()
while (($#)); do
  case "$1" in
    --replace) replace=1 ;;
    --) shift; extra=("$@"); break ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

sc2_bin="$(ls -d "$SC2_ROOT"/Versions/Base*/SC2.app/Contents/MacOS/SC2 | sort -V | tail -1)"
[[ -x "$sc2_bin" ]] || { echo "SC2 binary not found under $SC2_ROOT/Versions" >&2; exit 1; }

if pgrep -f "/SC2.app/Contents/MacOS/SC2" >/dev/null; then
  if ((replace)); then
    echo "Quitting running SC2…"
    pkill -f "/SC2.app/Contents/MacOS/SC2" || true
    for _ in {1..10}; do pgrep -f "/SC2.app/Contents/MacOS/SC2" >/dev/null || break; sleep 0.5; done
    # SC2 can ignore SIGTERM mid-game; a second instance exits at startup, so force it.
    pkill -9 -f "/SC2.app/Contents/MacOS/SC2" 2>/dev/null || true
    sleep 1
  else
    echo "SC2 is already running; pass --replace to quit it first." >&2
    exit 1
  fi
fi

name="$(basename "${map%/}")"
dest_dir="$SC2_ROOT/Maps/$TEST_SUBDIR"
mkdir -p "$dest_dir"
rm -rf "$dest_dir/$name"
cp -R "${map%/}" "$dest_dir/$name"

before="$(newest_session)"
args=(-run "$TEST_SUBDIR/$name" -displaymode 2 -preload 1 -reloadcheck -meleeMod Void -difficulty 2 -speed 2)
((${#extra[@]})) && args+=("${extra[@]}")

# Same working directory as the Editor's launch.
cd "$SC2_ROOT/Support"
nohup "$sc2_bin" "${args[@]}" >/dev/null 2>&1 &
pid=$!
disown
echo "Launched SC2 (pid $pid): ${args[*]}"

# Report the new session's log prefix once SC2 creates it.
for _ in {1..30}; do
  now="$(newest_session)"
  if [[ -n "$now" && "$now" != "$before" ]]; then
    echo "Log session: $now (read with: $0 --logs)"
    exit 0
  fi
  kill -0 "$pid" 2>/dev/null || { echo "SC2 exited during startup." >&2; exit 1; }
  sleep 1
done
echo "SC2 is running but no new log session appeared yet."
