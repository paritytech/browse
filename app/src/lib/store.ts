import { keccak_256 } from '@noble/hashes/sha3.js'

import { reviveCall } from './client'
import { CONTRACTS } from './config'
import { dlog } from './debug'

export interface StoreProduct {
  label: string
  name: string
  description: string
}

function computeSelector(sig: string): string {
  const hash = keccak_256(new TextEncoder().encode(sig))
  return Array.from(hash.slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('')
}

function stripPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}

function hexToBytes(hex: string): Uint8Array {
  const h = stripPrefix(hex)
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

const SEL_GET_PRODUCTS = computeSelector('getProducts()')

function decodeProductArray(data: `0x${string}`): StoreProduct[] {
  const hex = stripPrefix(data)
  if (hex.length < 128) return []

  const arrayOffset = parseInt(hex.slice(0, 64), 16) * 2
  const length = parseInt(hex.slice(arrayOffset, arrayOffset + 64), 16)
  const products: StoreProduct[] = []

  for (let i = 0; i < length; i++) {
    const offsetPos = arrayOffset + 64 + i * 64
    const elemOffset = parseInt(hex.slice(offsetPos, offsetPos + 64), 16) * 2
    const elemStart = arrayOffset + 64 + elemOffset

    const labelOffset = parseInt(hex.slice(elemStart, elemStart + 64), 16) * 2
    const nameOffset = parseInt(hex.slice(elemStart + 64, elemStart + 128), 16) * 2
    const descOffset = parseInt(hex.slice(elemStart + 128, elemStart + 192), 16) * 2

    const label = decodeStringAt(hex, elemStart + labelOffset)
    const name = decodeStringAt(hex, elemStart + nameOffset)
    const description = decodeStringAt(hex, elemStart + descOffset)

    products.push({ label, name, description })
  }

  return products
}

function decodeStringAt(hex: string, offset: number): string {
  const strLen = parseInt(hex.slice(offset, offset + 64), 16)
  if (strLen === 0) return ''
  const strHex = hex.slice(offset + 64, offset + 64 + strLen * 2)
  return new TextDecoder().decode(hexToBytes(strHex))
}

export async function fetchStoreProducts(): Promise<StoreProduct[]> {
  const t0 = performance.now()
  dlog('Store.getProducts()')
  try {
    const data = await reviveCall(CONTRACTS.STORE, `0x${SEL_GET_PRODUCTS}`)
    const products = decodeProductArray(data)
    dlog(`Store: ${products.length} products (${(performance.now() - t0).toFixed(0)}ms)`)
    return products
  } catch (err) {
    dlog(`Store.getProducts() failed (${(performance.now() - t0).toFixed(0)}ms): ${err}`, 'error')
    return []
  }
}
