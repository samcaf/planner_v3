#!/usr/bin/env bash
# Write the systemd user unit for THIS machine.
#
# The node path is the reason this is a script rather than a file you copy: a
# unit has no shell and no PATH to speak of, so `ExecStart=node` does not work,
# and an absolute path baked in on one machine is wrong on the next. nvm makes
# that worse — its node lives under a version directory that changes when you
# upgrade.
#
# It installs and reloads, but does NOT enable or start: on the machine you are
# migrating away from, `npm run dev` is probably still holding the port.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="$(command -v node || true)"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="$units/planner.service"
# The sync is a second unit, written the same way and started separately —
# the planner is useful without it, so it must be startable without it too.
sync_unit="$units/planner-sync.service"

[ -n "$node_bin" ] || { echo "node is not on PATH — install it first" >&2; exit 1; }
[ -d "$root/web/dist" ] || echo "warning: web/dist is missing — run 'npm run build' or every page will be blank" >&2

mkdir -p "$(dirname "$unit")"
sed -e "s|__ROOT__|$root|" -e "s|__NODE__|$node_bin|" "$root/scripts/planner.service" > "$unit"
sed -e "s|__ROOT__|$root|" -e "s|__NODE__|$node_bin|" "$root/scripts/planner-sync.service" > "$sync_unit"
systemctl --user daemon-reload

echo "wrote $unit"
echo "wrote $sync_unit"
echo "  node: $node_bin"
echo "  repo: $root"
echo
echo "next:"
echo "  systemctl --user enable --now planner"
echo "  loginctl enable-linger \"\$USER\"      # survive logging out"
echo "  tailscale serve --bg 8789            # the PUBLIC port, not 8787"
echo
echo "and, once the Teleonomy tab in Settings has a server and a token:"
echo "  systemctl --user enable --now planner-sync"
