# Required env vars (set in evm/.env):
#   MNEMONIC       Deployer's BIP39 mnemonic (defaults to //Alice dev key if unset)
#   GENESIS_HASH   Target network genesis hash (see scripts/network.ts)
#
# Per-network constructor args (e.g. dotnsRegistrar for Publisher) live in
# scripts/network.ts keyed by GENESIS_HASH — no extra env vars needed.

.PHONY: install build test deploy-publisher deploy-multicall3 publish-app clean

install :
	forge install
	cd scripts && npm install

build :
	forge build

test :
	forge test -vv

deploy-publisher : build
	@bash -c 'set -a && source .env && set +a && cd scripts && npm run deploy-publisher'

deploy-multicall3 : build
	@bash -c 'set -a && source .env && set +a && cd scripts && npm run deploy-multicall3'

# Usage: make publish-app LABEL=alice
publish-app :
	@bash -c 'set -a && source .env && set +a && cd scripts && npm run publish-app -- "$(LABEL)"'

clean :
	forge clean
