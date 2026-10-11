#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v pnpm >/dev/null 2>&1; then
	echo "error: pnpm is required but was not found on PATH" >&2
	echo "install it with: corepack enable pnpm" >&2
	exit 1
fi

if [ ! -d node_modules ]; then
	echo "installing dependencies..."
	pnpm install
fi

echo "starting dev server (pass --host to expose on LAN, Ctrl-C to stop)..."
exec pnpm run dev "$@"
