#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../app"

echo "=== Building browse.dot ==="

# 1. Vite build
npm run build

# 2. Copy dist into bundle/assets (same structure as vox)
rm -rf bundle/assets
cp -r dist bundle/assets
# Also update top-level index.html so both entry paths work
cp dist/index.html bundle/index.html

# 3. Pack into .prod
if [ -z "${PROD_PACK:-}" ]; then
  if command -v prod-pack &>/dev/null; then
    PROD_PACK="prod-pack"
  elif [ -f "../../host-rs/target/release/prod-pack" ]; then
    PROD_PACK="../../host-rs/target/release/prod-pack"
  elif [ -f "../../host-rs/target/debug/prod-pack" ]; then
    PROD_PACK="../../host-rs/target/debug/prod-pack"
  else
    echo "prod-pack not found. Either:"
    echo "  - Set PROD_PACK=/path/to/prod-pack"
    echo "  - Build it: cd ../host-rs && cargo build --release -p prod-pack"
    exit 1
  fi
fi

"$PROD_PACK" bundle browse.prod

# 4. Install to ~/.host/apps/ for host-rs resolution
mkdir -p ~/.host/apps
cp browse.prod ~/.host/apps/browse.prod

echo "=== Done: browse.prod (installed to ~/.host/apps/) ==="
ls -lh browse.prod
