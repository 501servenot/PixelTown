#!/bin/zsh
set -euo pipefail
role="${1:?usage: tools/kimi-body.sh scout|rover}"
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$role" in
  scout) file="$root/tools/kimi-scout.md"; name="Scout" ;;
  rover) file="$root/tools/kimi-rover.md"; name="Rover" ;;
  *) echo "usage: tools/kimi-body.sh scout|rover" >&2; exit 1 ;;
esac
cd "$root"
exec kimi --agent-file "$file" --prompt "进入 PixelTown 当 ${name}。先读 docs/agent.md，然后一直循环行动，至少 40 轮。有人说话就回，再继续探索。不要停。"
