SHELL := /bin/bash
.PHONY: build deploy

build:
	bun run build

deploy:
	@set -euo pipefail; \
	if [ -z "$${MNEMONIC:-}" ]; then \
		echo "Error: MNEMONIC is required. Pass it inline: MNEMONIC=\"...\" make deploy" >&2; \
		exit 1; \
	fi; \
	if [ ! -d dist/spa ] || [ ! -d dist/widget ]; then \
		echo "Error: build output missing. Run 'make build' first." >&2; \
		exit 1; \
	fi; \
	echo "==> Publishing browse.dot (app + widget)"; \
	MNEMONIC="$$MNEMONIC" NODE_OPTIONS="--max-old-space-size=8192" bulletin-deploy --publish dist/spa browse.dot; \
	echo "==> Done! Live at: https://browse.dot.li"
