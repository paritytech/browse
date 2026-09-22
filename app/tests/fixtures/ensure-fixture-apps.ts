/**
 * The fixture world: the demo apps under tests/fixture-projects that the specs
 * assert on. A network reset takes their names, their content and their
 * Publisher listings, so global setup puts back whatever is missing.
 *
 * Each app is deployed with bulletin-deploy from the master wallet only when
 * its name has no content, and published only when the Publisher does not list
 * it. Publishing goes through the registry operator, the substrate dev root,
 * which the deployed Publisher names as its owner. Idempotent: on a healthy
 * network this is one read per app.
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { previewnethub } from '@polkadot-api/descriptors'
import { DEV_PHRASE as STD_DEV_PHRASE } from '@polkadot-labs/hdkd-helpers'
import { Binary, createClient, type TypedApi } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'
import {
  bytesToHex,
  decodeFunctionResult,
  encodeFunctionData,
  hexToBytes,
  keccak256,
  namehash,
  parseAbi,
  toHex
} from 'viem'
import { nameWithTld, PASEONEXTV2_ASSETHUB_GENESIS } from '@parity/browse-sdk'
import { ASSETHUB_GENESIS, NETWORK } from '../../src/lib/config'
import { DEV_PHRASE as MASTER_PHRASE } from '../utils'

interface FixtureApp {
  /** Directory under tests/fixture-projects. */
  dir: string
  /** The dotNS label its bulletin-deploy config registers. */
  label: string
  /** Listed in the Publisher, so it shows in the All tab. */
  published: boolean
}

/**
 * Four published apps are a floor the app-start specs count on. alarm-clock
 * and countdown-timer stay unpublished so search resolves them live.
 */
const FIXTURE_APPS: FixtureApp[] = [
  { dir: 'calculator', label: 'calculator', published: true },
  { dir: 'stopwatch', label: 'stopwatch', published: true },
  { dir: 'chess-clock', label: 'chess-clock', published: true },
  { dir: 'unit-converter', label: 'unit-converter', published: true },
  { dir: 'alarm', label: 'alarm-clock', published: false },
  { dir: 'countdown', label: 'countdown-timer', published: false }
]

/** Any account works, these only ever dry-run. */
const DRY_RUN_ORIGIN = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1'

/** The bulletin-deploy the fixtures build with, pinned so a run is repeatable. */
const BULLETIN_DEPLOY_VERSION = '0.19.1'

const RESOLVER_ABI = parseAbi(['function contenthash(bytes32 node) view returns (bytes)'])
const PUBLISHER_ABI = parseAbi(['function isPublished(bytes32 labelhash) view returns (bool)'])

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const PROJECTS = resolve(ROOT, 'app/tests/fixture-projects')
/**
 * The bulletin-deploy environment id for the network the app is built against,
 * read from the config the app itself uses so an unset genesis cannot point the
 * deploy and the app at different networks.
 */
const bulletinEnv = (): string =>
  ASSETHUB_GENESIS === PASEONEXTV2_ASSETHUB_GENESIS ? 'paseo-next-v2' : 'preview'

type HubApi = TypedApi<typeof previewnethub>

/**
 * Read a contract. A call that could not run raises rather than answering
 * "nothing there", which would rebuild the whole fixture world over one bad
 * response.
 */
async function view(api: HubApi, address: string, data: `0x${string}`): Promise<`0x${string}`> {
  const result = await api.apis.ReviveApi.call(
    DRY_RUN_ORIGIN,
    address as `0x${string}`,
    0n,
    undefined,
    undefined,
    Binary.fromHex(data),
    { at: 'best' }
  )
  if (!result.result.success) {
    throw new Error(`reading ${address} failed: ${JSON.stringify(result.result.value)}`)
  }
  // A revert is the contract saying it holds nothing, which is an answer.
  if (result.result.value.flags !== 0) return '0x'
  // The typed api hands binary back as bytes, hex, or a Binary depending on the field.
  const returned: unknown = result.result.value.data
  const bytes =
    returned instanceof Uint8Array
      ? returned
      : typeof returned === 'string'
        ? hexToBytes(returned as `0x${string}`)
        : (returned as { asBytes: () => Uint8Array }).asBytes()
  return bytesToHex(bytes)
}

async function hasContent(api: HubApi, label: string): Promise<boolean> {
  const node = namehash(nameWithTld(label, NETWORK.TLD))
  const raw = await view(
    api,
    NETWORK.CONTENT_RESOLVER,
    encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'contenthash', args: [node] })
  )
  if (raw === '0x') return false
  const hash = decodeFunctionResult({ abi: RESOLVER_ABI, functionName: 'contenthash', data: raw })
  return hash !== '0x' && hash.length > 2
}

async function isPublished(api: HubApi, label: string): Promise<boolean> {
  const publisher = NETWORK.PUBLISHER[0]?.address
  if (!publisher) return false
  const raw = await view(
    api,
    publisher,
    encodeFunctionData({
      abi: PUBLISHER_ABI,
      functionName: 'isPublished',
      args: [keccak256(toHex(label))]
    })
  )
  if (raw === '0x') return false
  return decodeFunctionResult({ abi: PUBLISHER_ABI, functionName: 'isPublished', data: raw })
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): void {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

/** Build the fixture app and deploy it to its name, signed by the master wallet. */
function deployFixture(app: FixtureApp): void {
  const cwd = resolve(PROJECTS, app.dir)
  const domain = nameWithTld(app.label, NETWORK.TLD)
  console.log(`[fixture-apps] deploying ${domain} from tests/fixture-projects/${app.dir}`)
  run('bun', ['install', '--frozen-lockfile'], cwd)
  // The config imports bulletin-deploy, so install it beside the project
  // without touching its manifest or lockfile.
  run(
    'npm',
    ['install', '--no-save', '--no-package-lock', `bulletin-deploy@${BULLETIN_DEPLOY_VERSION}`],
    cwd
  )
  run('bun', ['run', 'build'], cwd, { MANIFEST_DOMAIN: domain })
  run(
    resolve(cwd, 'node_modules/.bin/bulletin-deploy'),
    [
      'dist',
      domain,
      '--env',
      bulletinEnv(),
      '--mnemonic',
      MASTER_PHRASE,
      '--derivation-path',
      '//wallet',
      '--js-merkle'
    ],
    cwd,
    { MANIFEST_DOMAIN: domain }
  )
}

/** List the label in the Publisher as its operator. */
function publishFixture(app: FixtureApp): void {
  console.log(`[fixture-apps] publishing ${app.label}`)
  run('npm', ['run', '-s', 'publish'], resolve(ROOT, 'evm'), {
    LABEL: app.label,
    MNEMONIC: STD_DEV_PHRASE,
    DERIVATION_PATH: '',
    NETWORK_GENESIS_HASH: ASSETHUB_GENESIS
  })
}

/** Put the fixture apps and their listings back where a reset removed them. */
export async function ensureFixtureApps(): Promise<void> {
  // Probe everything first and close the client before any deploy. A deploy
  // blocks this process for minutes, long enough for an open chain-head
  // subscription to lapse and the next read to complete without a value.
  const client = createClient(
    getWsProvider(NETWORK.ASSETHUB_RPCS[0], {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )
  const missing: { app: FixtureApp; content: boolean; listing: boolean }[] = []
  try {
    const api = client.getTypedApi(previewnethub)
    for (const app of FIXTURE_APPS) {
      const content = !(await hasContent(api, app.label))
      const listing = app.published && !(await isPublished(api, app.label))
      if (content || listing) missing.push({ app, content, listing })
    }
  } finally {
    try {
      client.destroy()
    } catch {
      // ignore teardown errors
    }
  }
  for (const { app, content, listing } of missing) {
    if (content) deployFixture(app)
    if (listing) publishFixture(app)
  }
}
