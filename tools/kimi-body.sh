#!/bin/zsh
set -euo pipefail
role="${1:?usage: tools/kimi-body.sh scout|rover|wren}"
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$role" in
  scout) file="$root/tools/kimi-scout.md"; name="Scout" ;;
  rover) file="$root/tools/kimi-rover.md"; name="Rover" ;;
  wren) file="$root/tools/kimi-wren.md"; name="Wren" ;;
  *) echo "usage: tools/kimi-body.sh scout|rover|wren" >&2; exit 1 ;;
esac
cd "$root"
trap 'exit 130' INT TERM
while true; do
  set +e
  kimi --agent-file "$file" --prompt "进入 PixelTown 当 ${name}。先读 docs/agent.md，然后持续循环行动，不要在 40 轮后停止；40 轮只是最低要求。有人说话就回，再继续探索。不要主动结束任务。"
  status=$?
  set -e
  if [[ "$status" -eq 130 ]]; then
    exit 130
  fi
  sleep 2
done
