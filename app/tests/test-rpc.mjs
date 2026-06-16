#!/usr/bin/env node
// Test: connect to Paseo Asset Hub via public RPC, query DotNS contracts.
// This bypasses smoldot to verify the contract queries work.
// Usage: node test-rpc.mjs

import { createClient } from 'polkadot-api'
import { Binary } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws-provider/node'

const { keccak_256 } = await import('@noble/hashes/sha3.js')

// ── Config ──────────────────────────────────────────────────

const CONTRACTS = {
  MULTICALL3: '0x0C206218c5949c00e51825364a7C3A17d9909ef6',
  STORE_FACTORY: '0x030296782F4d3046B080BcB017f01837561D9702',
  CONTENT_RESOLVER: '0x7756DF72CBc7f062e7403cD59e45fBc78bed1cD7',
  REGISTRY: '0x4Da0d37aBe96C06ab19963F31ca2DC0412057a6f'
}

// Try multiple endpoints in order
const RPC_ENDPOINTS = [
  'wss://sys.ibp.network/asset-hub-paseo',
  'wss://asset-hub-paseo.dotters.network',
  'wss://asset-hub-paseo-rpc.dwellir.com',
  'wss://paseo-asset-hub-rpc.polkadot.io'
]

const DUMMY_ORIGIN = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const WEIGHT_LIMIT = { ref_time: 18446744073709551615n, proof_size: 18446744073709551615n }
const STORAGE_LIMIT = 18446744073709551615n

// ── Timing helper ───────────────────────────────────────────

const t0 = performance.now()
function log(msg) {
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
  console.log(`[${elapsed}s] ${msg}`)
}

// ── Hex / ABI helpers ───────────────────────────────────────

function toHex(bytes) {
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function namehash(name) {
  let node = new Uint8Array(32)
  if (!name) return toHex(node)
  const labels = name.split('.').reverse()
  for (const label of labels) {
    const labelHash = keccak_256(new TextEncoder().encode(label))
    const combined = new Uint8Array(64)
    combined.set(node, 0)
    combined.set(labelHash, 32)
    node = new Uint8Array(keccak_256(combined))
  }
  return toHex(node)
}

function selector(sig) {
  const hash = keccak_256(new TextEncoder().encode(sig))
  return toHex(hash.slice(0, 4)).slice(2)
}

const SEL = {
  getAllDeployedStores: selector('getAllDeployedStores()'),
  getValues: selector('getValues()'),
  contenthash: selector('contenthash(bytes32)'),
  text: selector('text(bytes32,string)')
}

function encodeNoArgs(sel) {
  return `0x${sel}`
}

function encodeBytes32(sel, node) {
  return `0x${sel}${node.slice(2).padStart(64, '0')}`
}

function encodeText(node, key) {
  const nodeHex = node.slice(2).padStart(64, '0')
  const offset = BigInt(64).toString(16).padStart(64, '0')
  const keyBytes = new TextEncoder().encode(key)
  const keyHex = Array.from(keyBytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const keyLen = BigInt(keyBytes.length).toString(16).padStart(64, '0')
  const paddedLen = Math.ceil(keyBytes.length / 32) * 32
  const keyPadded = keyHex.padEnd(paddedLen * 2, '0')
  return `0x${SEL.text}${nodeHex}${offset}${keyLen}${keyPadded}`
}

// ── ABI decoders ────────────────────────────────────────────

function decodeAddressArray(hex) {
  hex = hex.startsWith('0x') ? hex.slice(2) : hex
  if (hex.length < 128) return []
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const length = parseInt(hex.slice(offset, offset + 64), 16)
  const addrs = []
  for (let i = 0; i < length; i++) {
    const start = offset + 64 + i * 64
    addrs.push('0x' + hex.slice(start + 24, start + 64))
  }
  return addrs
}

function decodeStringArray(hex) {
  hex = hex.startsWith('0x') ? hex.slice(2) : hex
  if (hex.length < 128) return []
  const arrOff = parseInt(hex.slice(0, 64), 16) * 2
  const length = parseInt(hex.slice(arrOff, arrOff + 64), 16)
  const strs = []
  for (let i = 0; i < length; i++) {
    const offPos = arrOff + 64 + i * 64
    const strOff = parseInt(hex.slice(offPos, offPos + 64), 16) * 2
    const strStart = arrOff + 64 + strOff
    const strLen = parseInt(hex.slice(strStart, strStart + 64), 16)
    if (strLen === 0) {
      strs.push('')
      continue
    }
    const strHex = hex.slice(strStart + 64, strStart + 64 + strLen * 2)
    const bytes = new Uint8Array(strLen)
    for (let j = 0; j < strLen; j++) bytes[j] = parseInt(strHex.slice(j * 2, j * 2 + 2), 16)
    strs.push(new TextDecoder().decode(bytes))
  }
  return strs
}

function decodeBytes(hex) {
  hex = hex.startsWith('0x') ? hex.slice(2) : hex
  if (hex.length < 128) return '0x'
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const length = parseInt(hex.slice(offset, offset + 64), 16) * 2
  return '0x' + hex.slice(offset + 64, offset + 64 + length)
}

function decodeString(hex) {
  hex = hex.startsWith('0x') ? hex.slice(2) : hex
  if (hex.length < 128) return ''
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const len = parseInt(hex.slice(offset, offset + 64), 16)
  if (len === 0) return ''
  const strHex = hex.slice(offset + 64, offset + 64 + len * 2)
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = parseInt(strHex.slice(i * 2, i * 2 + 2), 16)
  return new TextDecoder().decode(bytes)
}

// ── ReviveApi call ──────────────────────────────────────────

async function reviveCall(api, contractAddress, encodedData) {
  const result = await api.apis.ReviveApi.call(
    DUMMY_ORIGIN,
    Binary.fromHex(contractAddress),
    0n,
    WEIGHT_LIMIT,
    STORAGE_LIMIT,
    Binary.fromHex(encodedData)
  )

  const execResult = result.result
  const ok = execResult.value ?? (execResult.isOk ? execResult : null) ?? execResult.ok ?? null
  if (!ok) throw new Error('Revive call failed: no result')

  const flagsStr =
    typeof ok.flags === 'object' && ok.flags?.toString ? ok.flags.toString() : String(ok.flags ?? 0)
  if ((BigInt(flagsStr) & 1n) === 1n) throw new Error('Contract reverted')

  const data = ok.data
  if (typeof data === 'string') return data
  if (data?.asHex) return data.asHex()
  if (data?.toHex) return data.toHex()
  if (data instanceof Uint8Array) return toHex(data)
  return '0x'
}

// ── Main ────────────────────────────────────────────────────

async function tryConnect(endpoint, timeoutMs = 10_000) {
  log(`  Trying ${endpoint}...`)
  const provider = getWsProvider(endpoint)
  const client = createClient(provider)
  const block = await Promise.race([
    client.getFinalizedBlock(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ])
  return { client, block }
}

async function main() {
  log('Connecting to Paseo Asset Hub...')
  let client, block
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      ;({ client, block } = await tryConnect(endpoint))
      log(`Connected via ${endpoint}`)
      break
    } catch (err) {
      log(`  Failed: ${err.message}`)
    }
  }
  if (!client) {
    log('All RPC endpoints failed!')
    process.exit(1)
  }
  log(`Synced! Block #${block.number} (hash: ${block.hash})`)

  const api = client.getUnsafeApi()

  // ── Step 1: StoreFactory.getAllDeployedStores() ──
  log('Step 1: StoreFactory.getAllDeployedStores()...')
  const storesRaw = await reviveCall(
    api,
    CONTRACTS.STORE_FACTORY,
    encodeNoArgs(SEL.getAllDeployedStores)
  )
  const stores = decodeAddressArray(storesRaw)
  log(`  Found ${stores.length} stores`)
  for (const s of stores) log(`    ${s}`)

  if (stores.length === 0) {
    log('No stores found. Done.')
    client.destroy()
    return
  }

  // ── Step 2: getValues() on each store ──
  log('Step 2: Querying getValues() on each store...')
  const allLabels = new Set()
  for (const store of stores) {
    try {
      const raw = await reviveCall(api, store, encodeNoArgs(SEL.getValues))
      const labels = decodeStringArray(raw)
      log(`  ${store}: [${labels.join(', ')}]`)
      for (const l of labels) if (l) allLabels.add(l)
    } catch (err) {
      log(`  ${store}: ERROR ${err.message}`)
    }
  }

  // Normalize: strip ".dot" suffix if present
  const labels = Array.from(allLabels).map((l) => (l.endsWith('.dot') ? l.slice(0, -4) : l))
  const uniqueLabels = [...new Set(labels)]
  log(`Found ${uniqueLabels.length} unique labels: [${uniqueLabels.join(', ')}]`)

  if (uniqueLabels.length === 0) {
    log('No labels found. Done.')
    client.destroy()
    return
  }

  // ── Step 3: Metadata for each label ──
  log('Step 3: Querying metadata per label...')
  for (const label of uniqueLabels) {
    const node = namehash(`${label}.dot`)
    log(`  ${label}.dot (node: ${node.slice(0, 18)}...)`)

    try {
      const chRaw = await reviveCall(
        api,
        CONTRACTS.CONTENT_RESOLVER,
        encodeBytes32(SEL.contenthash, node)
      )
      const chBytes = decodeBytes(chRaw)
      log(`    contenthash: ${chBytes === '0x' ? '(empty)' : chBytes.slice(0, 30) + '...'}`)
    } catch (err) {
      log(`    contenthash: ERROR ${err.message}`)
    }

    try {
      const nameRaw = await reviveCall(api, CONTRACTS.CONTENT_RESOLVER, encodeText(node, 'name'))
      const name = decodeString(nameRaw)
      log(`    name: ${name || '(empty)'}`)
    } catch (err) {
      log(`    name: ERROR ${err.message}`)
    }

    try {
      const descRaw = await reviveCall(
        api,
        CONTRACTS.CONTENT_RESOLVER,
        encodeText(node, 'description')
      )
      const desc = decodeString(descRaw)
      log(`    description: ${desc || '(empty)'}`)
    } catch (err) {
      log(`    description: ERROR ${err.message}`)
    }
  }

  log('Done!')
  client.destroy()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
