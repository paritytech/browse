#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../app"

echo "=== Building browse-beta00.dot ==="

npm run build:spa

echo "=== Done ==="
