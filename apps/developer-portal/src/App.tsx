import type { ComponentChildren } from 'preact'

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { MODALITIES } from '@parity/browse-sdk'
import { getPreimageManager } from '@parity/product-sdk/host'

import { connectIdentity, type Identity } from './lib/account'
import { TLD, WEB_DOMAIN } from './lib/config'
import { readTracked, trackDomain, untrackDomain } from './lib/dashboard'
import { SNAPSHOT_MIN_PREFIX, suggestNames } from './lib/domains-snapshot'
import { filterPublications } from './lib/filter'
import { type DeploymentEntry, readDeployments, recordDeployment } from './lib/history'
import { digestHexToCid, useIconBlob } from './lib/icon'
import {
  fullName,
  listMyPublished,
  normalizeLabel,
  type Publication,
  publicationStatus,
  type PublicationStatus,
  submitPublish,
  type Verb
} from './lib/publisher'
import {
  readRecommendations,
  type RecommendationPoint,
  type RecommendationSeries
} from './lib/recommendations'
import {
  type MetadataEdit,
  type ModalityContent,
  type ProjectRecords,
  readModalityContenthashes,
  readProjectRecords,
  writeContenthash,
  writeProjectMetadata
} from './lib/records'

type View = 'grid' | 'list'

function shortHex(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`
}

function shortCid(cid: string): string {
  return `${cid.slice(0, 10)}…${cid.slice(-6)}`
}

/** A stable hue per label so each product card carries its own avatar tint. */
function hueOf(label: string): number {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) % 360
  return hash
}

function StatusIcon({ kind }: { kind: 'ok' | 'error' }) {
  return kind === 'ok' ? (
    <svg
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
    >
      <path d='M22 11.08V12a10 10 0 1 1-5.93-9.14' />
      <path d='M22 4 12 14.01l-3-3' />
    </svg>
  ) : (
    <svg
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
    >
      <path d='M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z' />
      <line x1='12' y1='8' x2='12' y2='12' />
      <line x1='12' y1='16' x2='12.01' y2='16' />
    </svg>
  )
}

/** An inline icon and message line for validation and transaction feedback. */
function StatusLine({ kind, text }: { kind: 'ok' | 'error'; text: string }) {
  return (
    <p class={`feedback feedback-${kind}`}>
      <StatusIcon kind={kind} />
      {text}
    </p>
  )
}

/** Load the dotNS records of a label for display, with a failure flag. */
function useProjectRecords(label: string): { records: ProjectRecords | null; failed: boolean } {
  const [records, setRecords] = useState<ProjectRecords | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setRecords(null)
    setFailed(false)
    readProjectRecords(label).then(
      (result) => {
        if (!cancelled) setRecords(result)
      },
      () => {
        if (!cancelled) setFailed(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [label])
  return { records, failed }
}

/** The product icon from the manifest, or the tinted letter fallback. */
function ProductAvatar({
  label,
  records,
  large
}: {
  label: string
  records: ProjectRecords | null
  large?: boolean
}) {
  const icon = useIconBlob(records?.manifest?.icon.cid ?? null, records?.manifest?.icon.format)
  return (
    <span
      class={`avatar${large ? ' avatar-lg' : ''}`}
      style={{ background: `hsl(${hueOf(label)} 52% 42%)` }}
    >
      {icon.url && !icon.failed ? (
        <img class='avatar-img' src={icon.url} alt='' />
      ) : (
        label.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}

/**
 * One domain on the dashboard.
 *
 * A tracked domain is local to this portal, so `publication` is null until the
 * label is published to the registry.
 */
export type DomainEntry = { label: string; publication: Publication | null }

/** One product card: live records, the publish meta line, and a reserved sparkline slot. */
function ProductCard({
  domain,
  unpublishing,
  menu
}: {
  domain: DomainEntry
  unpublishing: boolean
  menu: ComponentChildren
}) {
  const { records } = useProjectRecords(domain.label)
  const displayName = records?.manifest?.displayName ?? fullName(domain.label)
  const { publication } = domain
  return (
    <article class='card'>
      <div class='card-head'>
        <ProductAvatar label={domain.label} records={records} />
        <div class='card-id'>
          <h3 class='card-name'>{displayName}</h3>
          <a
            class='card-domain'
            href={`https://${domain.label}.${WEB_DOMAIN}`}
            target='_blank'
            rel='noreferrer'
          >
            {`${domain.label}.${WEB_DOMAIN}`}
          </a>
        </div>
        <span class='card-sparkline' aria-hidden='true' />
        {menu}
      </div>
      {(publication || unpublishing) && (
        <span class='repo-pill'>
          <span class='dot-live' aria-hidden='true' />
          {unpublishing ? 'Unpublishing…' : 'Published'}
        </span>
      )}

      {publication && (
        <div class='card-meta'>
          {shortHex(publication.publisher)} ·{' '}
          {new Date(publication.timestamp * 1000).toLocaleDateString()}
        </div>
      )}
    </article>
  )
}

/** One settings card: title, copy, the controls, and a Save footer. */
function SettingsCard({
  title,
  description,
  control,
  saving,
  dirty,
  notice,
  onSave
}: {
  title: string
  description: string
  control: ComponentChildren
  saving: boolean
  dirty: boolean
  notice: { kind: 'ok' | 'error'; text: string } | null
  onSave: () => void
}) {
  return (
    <div class='settings-card'>
      <h3 class='settings-title'>{title}</h3>
      <p class='settings-desc'>{description}</p>
      {control}
      <div class='settings-foot'>
        {notice && <StatusLine kind={notice.kind} text={notice.text} />}
        <button
          type='button'
          class='btn btn-primary btn-sm'
          disabled={saving || !dirty}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/** One labelled form row: the label, the control, and an optional hint under it. */
function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ComponentChildren
}) {
  return (
    <label class='form-field'>
      <span class='form-label'>{label}</span>
      {children}
      {hint && <span class='form-hint'>{hint}</span>}
    </label>
  )
}

function DomainRow({
  name,
  sub,
  live,
  tag
}: {
  name: string
  sub: string
  live: boolean
  tag: string
}) {
  return (
    <li class='domain-row'>
      <span class={`domain-icon${live ? ' domain-live' : ''}`}>
        <StatusIcon kind='ok' />
      </span>
      <span class='domain-id'>
        <span class='domain-name'>{name}</span>
        <span class='domain-sub'>{sub}</span>
      </span>
      <span class='domain-tag'>{tag}</span>
    </li>
  )
}

const CHART_WIDTH = 640
const CHART_HEIGHT = 180
const CHART_PAD = { top: 12, right: 8, bottom: 24, left: 36 }

/**
 * Cumulative recommendations as an area chart.
 *
 * A single point has no span to draw across, so it renders as a flat line at its
 * own value: the alternative is an empty plot for a project with one
 * recommendation.
 */
function RecommendationChart({ points }: { points: RecommendationPoint[] }) {
  const plotWidth = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right
  const plotHeight = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom
  const peak = Math.max(1, ...points.map((point) => point.total))
  const lastIndex = points.length - 1

  const x = (index: number): number =>
    CHART_PAD.left + (lastIndex === 0 ? plotWidth : (index / lastIndex) * plotWidth)
  const y = (total: number): number => CHART_PAD.top + plotHeight - (total / peak) * plotHeight

  const line = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(point.total)}`).join(' ')
  const area = `M${CHART_PAD.left} ${y(points[0]!.total)} ${line.slice(1)} L${x(lastIndex)} ${
    CHART_PAD.top + plotHeight
  } L${CHART_PAD.left} ${CHART_PAD.top + plotHeight} Z`

  const day = (at: number): string =>
    new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <svg
      class='chart'
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role='img'
      aria-label={`${points[lastIndex]!.total} recommendations by ${day(points[lastIndex]!.at)}`}
    >
      {[0, peak].map((tick) => (
        <g key={tick}>
          <line
            class='chart-grid'
            x1={CHART_PAD.left}
            x2={CHART_WIDTH - CHART_PAD.right}
            y1={y(tick)}
            y2={y(tick)}
          />
          <text class='chart-tick' x={CHART_PAD.left - 8} y={y(tick) + 4} text-anchor='end'>
            {tick}
          </text>
        </g>
      ))}
      <path class='chart-area' d={area} />
      <path class='chart-line' d={line} />
      <circle class='chart-head' cx={x(lastIndex)} cy={y(points[lastIndex]!.total)} r='3.5' />
      <text class='chart-tick' x={CHART_PAD.left} y={CHART_HEIGHT - 6}>
        {day(points[0]!.at)}
      </text>
      <text
        class='chart-tick'
        x={CHART_WIDTH - CHART_PAD.right}
        y={CHART_HEIGHT - 6}
        text-anchor='end'
      >
        {day(points[lastIndex]!.at)}
      </text>
    </svg>
  )
}

type DetailTab = 'overview' | 'deployments' | 'domains' | 'settings' | 'analytics'

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'domains', label: 'Domains' },
  { id: 'settings', label: 'Settings' },
  { id: 'analytics', label: 'Analytics' }
]

const SOURCE_LABELS: Record<DeploymentEntry['source'], string> = {
  observed: 'Observed',
  edit: 'Edit',
  revert: 'Rollback'
}

/** The project view for one domain: a header fed by live records, then Overview, Deployments, Domains, Settings, and Analytics tabs. */
function DetailPage({
  label,
  tab,
  onTab
}: {
  label: string
  tab: DetailTab
  onTab: (tab: DetailTab) => void
}) {
  const { records, failed: recordsFailed } = useProjectRecords(label)
  const [status, setStatus] = useState<PublicationStatus | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)
  const [modalities, setModalities] = useState<ModalityContent | null>(null)
  const [modalitiesFailed, setModalitiesFailed] = useState(false)
  const [recommendations, setRecommendations] = useState<RecommendationSeries | null>(null)
  const [recommendationsFailed, setRecommendationsFailed] = useState(false)

  useEffect(() => {
    if (tab !== 'analytics') return
    let cancelled = false
    setRecommendations(null)
    setRecommendationsFailed(false)
    readRecommendations(label).then(
      (series) => {
        if (!cancelled) setRecommendations(series)
      },
      () => {
        if (!cancelled) setRecommendationsFailed(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [tab, label])

  useEffect(() => {
    let cancelled = false
    setStatus(null)
    setStatusFailed(false)
    setModalities(null)
    setModalitiesFailed(false)
    publicationStatus(label).then(
      (result) => {
        if (!cancelled) setStatus(result)
      },
      () => {
        if (!cancelled) setStatusFailed(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [label])

  // The modality reads wait for the Domains tab, which keeps navigation from
  // bursting calls the other tabs never use.
  useEffect(() => {
    if (tab !== 'domains' || modalities || modalitiesFailed) return
    let cancelled = false
    readModalityContenthashes(label).then(
      (result) => {
        if (!cancelled) setModalities(result)
      },
      () => {
        if (!cancelled) setModalitiesFailed(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [tab, label, modalities, modalitiesFailed])

  const [action, setAction] = useState<Verb | null>(null)
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false)
  const [actionNotice, setActionNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null
  )
  const [nameInput, setNameInput] = useState('')
  const [descriptionInput, setDescriptionInput] = useState('')
  const [iconUpload, setIconUpload] = useState<{ cid: string; format: 'png' | 'jpeg' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!records) return
    setNameInput(records.manifest?.displayName ?? records.name ?? '')
    setDescriptionInput(records.manifest?.description ?? records.description ?? '')
    setIconUpload(null)
    setSaveNotice(null)
  }, [records])

  const [history, setHistory] = useState<DeploymentEntry[] | null>(null)
  const [confirmingRevert, setConfirmingRevert] = useState<number | null>(null)
  const [reverting, setReverting] = useState(false)
  const [revertNotice, setRevertNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null
  )

  // Every visit indexes the current deployment, so the history grows from
  // observation without any backend history to read.
  useEffect(() => {
    let cancelled = false
    setHistory(null)
    setConfirmingRevert(null)
    setRevertNotice(null)
    if (!records) return
    const load = records.contentHash
      ? recordDeployment(label, {
          cid: records.contentHash,
          hashHex: records.contentHashHex,
          version: records.manifestVersion,
          source: 'observed'
        })
      : readDeployments(label)
    load.then((entries) => {
      if (!cancelled) setHistory(entries)
    })
    return () => {
      cancelled = true
    }
  }, [label, records])

  const runRevert = useCallback(
    async (entry: DeploymentEntry) => {
      setReverting(true)
      setRevertNotice(null)
      try {
        if (!entry.hashHex) {
          throw new Error('This entry predates hash capture and cannot be replayed.')
        }
        const id = await connectIdentity()
        await writeContenthash(label, entry.hashHex as `0x${string}`, id)
        const next = await recordDeployment(label, {
          cid: entry.cid,
          hashHex: entry.hashHex,
          version: entry.version,
          source: 'revert'
        })
        setHistory(next)
        setRevertNotice({ kind: 'ok', text: `Rolled back to ${shortCid(entry.cid)}.` })
      } catch (err) {
        setRevertNotice({ kind: 'error', text: (err as Error).message })
      } finally {
        setReverting(false)
        setConfirmingRevert(null)
      }
    },
    [label]
  )

  const uploadPreview = useIconBlob(iconUpload?.cid ?? null, iconUpload?.format)

  const onIconPick = useCallback(async (file: File) => {
    const manager = await getPreimageManager()
    if (!manager) {
      setSaveNotice({ kind: 'error', text: 'Host unavailable' })
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const key = await manager.submit(bytes)
    const format = file.type === 'image/jpeg' ? ('jpeg' as const) : ('png' as const)
    setIconUpload({ cid: digestHexToCid(key), format })
    setSaveNotice(null)
  }, [])

  const icon = iconUpload ?? records?.manifest?.icon ?? null

  // One manifest write covers all three fields, so the Save button tracks any of
  // them diverging from what the manifest currently holds.
  const dirty =
    !!records &&
    (nameInput.trim() !== (records.manifest?.displayName ?? '') ||
      descriptionInput.trim() !== (records.manifest?.description ?? '') ||
      icon?.cid !== records.manifest?.icon.cid)

  const runSave = useCallback(async () => {
    setSaving(true)
    setSaveNotice(null)
    try {
      if (!nameInput.trim()) throw new Error('Enter a display name.')
      if (!icon) throw new Error('Choose an icon. The manifest cannot be written without one.')
      const edit: MetadataEdit = {
        displayName: nameInput.trim(),
        description: descriptionInput.trim(),
        icon
      }
      const id = await connectIdentity()
      await writeProjectMetadata(label, edit, id)
      if (records?.contentHash) {
        const next = await recordDeployment(label, {
          cid: records.contentHash,
          hashHex: records.contentHashHex,
          version: records.manifestVersion,
          source: 'edit'
        })
        setHistory(next)
      }
      setSaveNotice({ kind: 'ok', text: 'Saved. The manifest updates at the next block.' })
    } catch (err) {
      setSaveNotice({ kind: 'error', text: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }, [label, nameInput, descriptionInput, icon, records])

  // Identity is requested here and nowhere else on this page, so reads stay
  // anonymous and only an explicit action triggers the host login.
  const runAction = useCallback(
    async (verb: Verb) => {
      setAction(verb)
      setActionNotice(null)
      try {
        const id = await connectIdentity()
        await submitPublish(verb, label, id)
        setActionNotice({
          kind: 'ok',
          text:
            verb === 'publish' ? `Published ${fullName(label)}.` : `Unpublished ${fullName(label)}.`
        })
        setStatus(await publicationStatus(label))
      } catch (err) {
        setActionNotice({ kind: 'error', text: (err as Error).message })
      } finally {
        setAction(null)
        setConfirmingUnpublish(false)
      }
    },
    [label]
  )

  const loading = !records && !recordsFailed
  const displayName = records?.manifest?.displayName ?? records?.name ?? fullName(label)
  const description = records?.manifest?.description ?? records?.description ?? null

  return (
    <div class='page'>
      <header class='detail-head'>
        <ProductAvatar label={label} records={records} large />
        <div class='detail-id'>
          {loading ? (
            <span class='skeleton-line skeleton-title' />
          ) : (
            <h1 class='detail-name'>{displayName}</h1>
          )}
          {description && <p class='detail-desc'>{description}</p>}
          <a
            class='card-domain'
            href={`https://${label}.${WEB_DOMAIN}`}
            target='_blank'
            rel='noreferrer'
          >
            {`${label}.${WEB_DOMAIN}`}
          </a>
        </div>
        <a
          class='btn btn-ghost btn-sm'
          href={`https://${label}.${WEB_DOMAIN}`}
          target='_blank'
          rel='noreferrer'
        >
          Open
        </a>
      </header>

      <section class='tab-panel'>
        {tab === 'overview' && (
          <div class='hero-deploy'>
            <div class='hero-top'>
              <h2 class='hero-title'>Production Deployment</h2>
              <div class='hero-actions'>
                {status && !status.published && (
                  <button
                    type='button'
                    class='btn btn-primary btn-sm'
                    disabled={action !== null}
                    onClick={() => void runAction('publish')}
                  >
                    {action === 'publish' ? 'Publishing…' : 'Publish'}
                  </button>
                )}
                <button
                  type='button'
                  class='btn btn-ghost btn-sm'
                  disabled={(history?.length ?? 0) < 2}
                  onClick={() => onTab('deployments')}
                >
                  Rollback
                </button>
                <a
                  class='btn btn-primary btn-sm'
                  href={`https://${label}.${WEB_DOMAIN}`}
                  target='_blank'
                  rel='noreferrer'
                >
                  Visit
                </a>
              </div>
            </div>
            {actionNotice && <StatusLine kind={actionNotice.kind} text={actionNotice.text} />}
            {statusFailed ? (
              <StatusLine
                kind='error'
                text='Could not load the deployment status from the network.'
              />
            ) : !status ? (
              <span class='skeleton-line' />
            ) : (
              <dl class='facts'>
                <div class='fact'>
                  <dt>Status</dt>
                  <dd class='hero-status'>
                    <span
                      class={`status-dot ${status.published ? 'status-ready' : 'status-off'}`}
                    />
                    {status.published ? 'Ready' : 'Not published'}
                  </dd>
                </div>
                {status.publisher && (
                  <div class='fact'>
                    <dt>Publisher</dt>
                    <dd class='fact-mono'>{shortHex(status.publisher)}</dd>
                  </div>
                )}
                {status.timestamp !== null && (
                  <div class='fact'>
                    <dt>Published</dt>
                    <dd>{new Date(status.timestamp * 1000).toLocaleDateString()}</dd>
                  </div>
                )}
                {records?.contentHash && (
                  <div class='fact'>
                    <dt>Content</dt>
                    <dd class='fact-mono'>{shortCid(records.contentHash)}</dd>
                  </div>
                )}
                <div class='fact'>
                  <dt>Domain</dt>
                  <dd>{fullName(label)}</dd>
                </div>
              </dl>
            )}
          </div>
        )}
        {tab === 'deployments' &&
          (!history ? (
            <span class='skeleton-line' />
          ) : history.length === 0 ? (
            <div class='empty-state'>
              <p>
                No deployments recorded yet. This portal records history locally as it observes the
                domain, since the chain keeps only the current state.
              </p>
            </div>
          ) : (
            <div class='deploy-panel'>
              {revertNotice && <StatusLine kind={revertNotice.kind} text={revertNotice.text} />}
              <ul class='deploy-list'>
                {history.map((entry, index) => (
                  <li class='deploy-item' key={`${entry.at}-${entry.cid}`}>
                    <span class='deploy-id'>
                      <span class='deploy-cid'>{shortCid(entry.cid)}</span>
                      <span class='deploy-sub'>
                        {entry.version ? `v${entry.version} · ` : ''}
                        {new Date(entry.at).toLocaleString()}
                      </span>
                    </span>
                    <span class='deploy-source'>{SOURCE_LABELS[entry.source]}</span>
                    {index === 0 ? (
                      <span class='deploy-pill'>Current</span>
                    ) : confirmingRevert === entry.at ? (
                      <button
                        type='button'
                        class='btn btn-danger btn-sm deploy-revert'
                        disabled={reverting}
                        onClick={() => void runRevert(entry)}
                      >
                        {reverting ? 'Rolling back…' : 'Confirm rollback'}
                      </button>
                    ) : (
                      <button
                        type='button'
                        class='btn btn-ghost btn-sm deploy-revert'
                        disabled={reverting}
                        onClick={() => setConfirmingRevert(entry.at)}
                      >
                        Rollback
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        {tab === 'domains' &&
          (modalitiesFailed || recordsFailed ? (
            <StatusLine kind='error' text='Could not load the domain records from the network.' />
          ) : !modalities || !records ? (
            <span class='skeleton-line' />
          ) : (
            <ul class='domains-table'>
              <DomainRow
                name={fullName(label)}
                sub={records.contentHash ? shortCid(records.contentHash) : 'No content'}
                live={!!records.contentHash}
                tag='Root'
              />
              {MODALITIES.map((modality) => (
                <DomainRow
                  key={modality}
                  name={`${modality}.${fullName(label)}`}
                  sub={modalities[modality] ? shortCid(modalities[modality]) : 'No content'}
                  live={!!modalities[modality]}
                  tag={modality}
                />
              ))}
            </ul>
          ))}
        {tab === 'settings' && (
          <div class='settings-cards'>
            <SettingsCard
              title='Project'
              description='The manifest the browse client reads. Saving writes all three fields in one transaction.'
              saving={saving}
              dirty={dirty}
              notice={saveNotice}
              onSave={() => void runSave()}
              control={
                <div class='form-rows'>
                  <Field label='Display Name' hint='Shown on the product card and the listing.'>
                    <input
                      class='input'
                      type='text'
                      value={nameInput}
                      placeholder='Display name'
                      disabled={!records}
                      onInput={(event) => setNameInput((event.target as HTMLInputElement).value)}
                    />
                  </Field>
                  <Field label='Description' hint='One sentence about what the product does.'>
                    <textarea
                      class='input input-area'
                      rows={3}
                      value={descriptionInput}
                      placeholder='Description'
                      disabled={!records}
                      onInput={(event) =>
                        setDescriptionInput((event.target as HTMLTextAreaElement).value)
                      }
                    />
                  </Field>
                  <Field
                    label='Icon'
                    hint='A square png or jpeg, stored on Bulletin and resolved by its CID.'
                  >
                    <div class='icon-control'>
                      {uploadPreview.url ? (
                        <img class='icon-preview' src={uploadPreview.url} alt='' />
                      ) : (
                        <ProductAvatar label={label} records={records} />
                      )}
                      <div class='icon-meta'>
                        <label class='file-button'>
                          Choose file
                          <input
                            type='file'
                            accept='image/png,image/jpeg'
                            onChange={(event) => {
                              const file = (event.target as HTMLInputElement).files?.[0]
                              if (file) void onIconPick(file)
                            }}
                          />
                        </label>
                        {icon && <span class='icon-cid'>{icon.cid}</span>}
                      </div>
                    </div>
                  </Field>
                </div>
              }
            />
            <div class='settings-card settings-danger'>
              <h3 class='settings-title'>Unpublish Product</h3>
              <p class='settings-desc'>
                Remove {fullName(label)} from the browse registry. The domain and its content stay
                untouched.
              </p>
              <div class='settings-foot'>
                {actionNotice && <StatusLine kind={actionNotice.kind} text={actionNotice.text} />}
                {confirmingUnpublish ? (
                  <button
                    type='button'
                    class='btn btn-danger btn-sm'
                    disabled={action !== null}
                    onClick={() => void runAction('unpublish')}
                  >
                    {action === 'unpublish' ? 'Unpublishing…' : 'Confirm unpublish'}
                  </button>
                ) : (
                  <button
                    type='button'
                    class='btn btn-danger btn-sm'
                    disabled={action !== null || !status?.published}
                    onClick={() => setConfirmingUnpublish(true)}
                  >
                    Unpublish
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {tab === 'analytics' && (
          <div class='analytics-empty'>
            <div class='analytics-lead'>
              <h2 class='hero-title'>Recommendations</h2>
              <p class='settings-desc'>How many people recommend {fullName(label)} in browse.</p>
            </div>
            {recommendationsFailed ? (
              <StatusLine kind='error' text='Could not load recommendations from the network.' />
            ) : (
              <>
                <div class='kpi-strip'>
                  <div class='kpi-tab'>
                    <span class='kpi-label'>Total</span>
                    <span class='kpi-value'>
                      {recommendations === null ? '…' : recommendations.total.toLocaleString()}
                    </span>
                  </div>
                </div>
                {recommendations === null ? (
                  <span class='skeleton-line' />
                ) : recommendations.points.length === 0 ? (
                  <p class='empty'>Nobody has recommended this project yet.</p>
                ) : (
                  <RecommendationChart points={recommendations.points} />
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * The persistent left rail.
 *
 * Top-level destinations first, then the sections of the open project. The project
 * items keep `role="tab"` because they switch panels inside the detail view
 * rather than navigating away from it.
 */
function Sidebar({
  onProducts,
  onAdd,
  productsActive,
  project,
  tab,
  onTab
}: {
  onProducts: () => void
  onAdd: () => void
  productsActive: boolean
  project: string | null
  tab: DetailTab
  onTab: (tab: DetailTab) => void
}) {
  return (
    <aside class='sidebar'>
      <span class='sidebar-mark' aria-hidden='true' />
      <nav class='nav'>
        <button type='button' class='nav-item' onClick={onAdd}>
          <svg
            width='20'
            height='20'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='1.8'
            stroke-linecap='round'
            stroke-linejoin='round'
          >
            <path d='M12 5v14' />
            <path d='M5 12h14' />
          </svg>
          <span class='nav-label'>Add new</span>
        </button>
        <button
          type='button'
          class={`nav-item${productsActive ? ' active' : ''}`}
          onClick={onProducts}
        >
          <svg
            width='20'
            height='20'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='1.8'
            stroke-linecap='round'
            stroke-linejoin='round'
          >
            <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
            <path d='M3.27 6.96 12 12.01l8.73-5.05' />
            <path d='M12 22.08V12' />
          </svg>
          <span class='nav-label'>Products</span>
        </button>
        <button type='button' class='nav-item nav-disabled' disabled>
          <svg
            width='20'
            height='20'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='1.8'
            stroke-linecap='round'
            stroke-linejoin='round'
          >
            <circle cx='12' cy='8' r='6' />
            <path d='M15.477 12.89 17 22l-5-3-5 3 1.523-9.11' />
          </svg>
          <span class='nav-label'>Certificates</span>
          <span class='nav-badge'>Coming soon</span>
        </button>
      </nav>

      {project && (
        <nav class='nav nav-section' role='tablist'>
          <span class='nav-heading' title={fullName(project)}>
            {fullName(project)}
          </span>
          {DETAIL_TABS.map((entry) => (
            <button
              key={entry.id}
              type='button'
              role='tab'
              aria-selected={tab === entry.id}
              class={`nav-item nav-sub${tab === entry.id ? ' active' : ''}`}
              onClick={() => onTab(entry.id)}
            >
              <span class='nav-label'>{entry.label}</span>
            </button>
          ))}
        </nav>
      )}
    </aside>
  )
}

export function App() {
  const [route, setRoute] = useState<string>(() => window.location.pathname)

  const [identity, setIdentity] = useState<Identity | null>(null)

  const [domains, setDomains] = useState<DomainEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')

  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('grid')

  const [label, setLabel] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggest, setShowSuggest] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const onPublishRoute = route.endsWith('/publish')
  const detailMatch = route.match(/\/d\/([^/]+)$/)
  const detailLabel = detailMatch ? decodeURIComponent(detailMatch[1]) : null
  const clean = normalizeLabel(label)

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path)
    setRoute(path)
  }, [])

  // A different project always opens on its Overview section.
  useEffect(() => {
    setDetailTab('overview')
  }, [detailLabel])

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // The tracked list leads and network publications only decorate it. A label this
  // account published elsewhere is folded in even when it is not tracked yet.
  const refreshList = useCallback(async (id: Identity | null) => {
    setListError(null)
    const tracked = await readTracked()
    if (!id) {
      setDomains(tracked.map((label) => ({ label, publication: null })))
      return
    }
    try {
      const published = await listMyPublished(id.h160)
      const byLabel = new Map(published.map((publication) => [publication.label, publication]))
      const extra = published.filter((publication) => !tracked.includes(publication.label))
      setDomains([
        ...tracked.map((label) => ({ label, publication: byLabel.get(label) ?? null })),
        ...extra.map((publication) => ({ label: publication.label, publication }))
      ])
    } catch (err) {
      setDomains(tracked.map((label) => ({ label, publication: null })))
      setListError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // The tracked list is local, so the grid fills on load without a host.
  useEffect(() => {
    void refreshList(null)
  }, [refreshList])

  // Resolve the connected identity, requesting it from the host only on the
  // first explicit publish action. It is never requested on load.
  const ensureIdentity = useCallback(async (): Promise<Identity> => {
    if (identity) return identity
    const id = await connectIdentity()
    setIdentity(id)
    void refreshList(id)
    return id
  }, [identity, refreshList])

  // Autocompletion from the verifiable domain snapshot.
  const suggestToken = useRef(0)
  useEffect(() => {
    if (!onPublishRoute || clean.length < SNAPSHOT_MIN_PREFIX) {
      setSuggestions([])
      return
    }
    const token = ++suggestToken.current
    const timer = setTimeout(async () => {
      const names = await suggestNames(clean)
      if (token === suggestToken.current) setSuggestions(names)
    }, 200)
    return () => clearTimeout(timer)
  }, [onPublishRoute, clean])

  const closeMenu = useCallback(() => {
    setMenuFor(null)
    setConfirming(null)
  }, [])

  const shell = (body: ComponentChildren) => (
    <div class='app'>
      <div class='shell'>
        <Sidebar
          onProducts={() => {
            setNotice(null)
            navigate('/')
          }}
          onAdd={() => {
            setNotice(null)
            navigate('/publish')
          }}
          productsActive={!onPublishRoute && !detailLabel}
          project={detailLabel}
          tab={detailTab}
          onTab={setDetailTab}
        />
        {body}
      </div>
      {menuFor && <div class='backdrop' onClick={closeMenu} />}
    </div>
  )

  const canAdd = !!clean && pending === null

  // Adding a domain is local: it records the label this portal tracks and signs
  // nothing. Publishing it to the registry is the separate step on the detail
  // page, so neither the host nor an identity is needed here.
  const runAdd = useCallback(async () => {
    if (!clean || !canAdd) return
    setNotice(null)
    setPending('add')
    try {
      await trackDomain(clean)
      setLabel('')
      await refreshList(identity)
      navigate(`/d/${clean}`)
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setPending(null)
    }
  }, [clean, canAdd, identity, refreshList, navigate])

  const runRemove = useCallback(
    async (target: string) => {
      closeMenu()
      setNotice(null)
      await untrackDomain(target)
      await refreshList(identity)
      setNotice({ kind: 'ok', text: `Removed ${fullName(target)} from this dashboard.` })
    },
    [closeMenu, identity, refreshList]
  )

  const runUnpublish = useCallback(
    async (target: string) => {
      closeMenu()
      setNotice(null)
      setPending(`unpublish:${target}`)
      try {
        const id = await ensureIdentity()
        await submitPublish('unpublish', target, id)
        setNotice({ kind: 'ok', text: `Unpublished ${fullName(target)}.` })
        void refreshList(id)
      } catch (err) {
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      } finally {
        setPending(null)
      }
    },
    [ensureIdentity, refreshList, closeMenu]
  )

  const selectSuggestion = useCallback((name: string) => {
    setLabel(name)
    setShowSuggest(false)
  }, [])

  if (onPublishRoute) {
    return shell(
      <div class='page page-publish'>
        <button
          type='button'
          class='back'
          onClick={() => {
            setNotice(null)
            navigate('/')
          }}
        >
          <svg
            width='18'
            height='18'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M15 18l-6-6 6-6' stroke-linecap='round' stroke-linejoin='round' />
          </svg>
          Back
        </button>

        <h1 class='page-title'>Let's add a domain</h1>

        <div class='publish-box'>
          <form
            class='field-row'
            onSubmit={(event) => {
              event.preventDefault()
              if (canAdd) void runAdd()
            }}
          >
            <div class='field'>
              <input
                type='text'
                value={label}
                placeholder='domain'
                autocomplete='off'
                spellcheck={false}
                autofocus
                disabled={pending !== null}
                onInput={(event) => {
                  setLabel((event.target as HTMLInputElement).value)
                  setShowSuggest(true)
                }}
              />
              <span class='field-suffix'>.{TLD}</span>
            </div>
            <button type='submit' class='btn btn-primary' disabled={!canAdd}>
              {pending === 'add' ? 'Adding…' : 'Add'}
            </button>
          </form>

          {showSuggest && suggestions.length > 0 && (
            <ul class='suggest'>
              {suggestions.map((name) => (
                <li key={name}>
                  <button type='button' class='suggest-item' onClick={() => selectSuggestion(name)}>
                    {fullName(name)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {notice && <StatusLine kind={notice.kind} text={notice.text} />}
      </div>
    )
  }

  if (detailLabel) {
    return shell(<DetailPage label={detailLabel} tab={detailTab} onTab={setDetailTab} />)
  }

  const q = query.trim().toLowerCase()
  const visible = domains ? filterPublications(domains, query) : null

  return shell(
    <div class='page'>
      <div class='toolbar'>
        <div class='search'>
          <span class='search-icon' aria-hidden='true'>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='11' cy='11' r='7' />
              <path d='M21 21l-4.3-4.3' stroke-linecap='round' />
            </svg>
          </span>
          <input
            type='text'
            value={query}
            placeholder='Search Products…'
            autocomplete='off'
            spellcheck={false}
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          />
        </div>

        <div class='seg' role='group' aria-label='View'>
          <button
            type='button'
            class={`seg-btn${view === 'grid' ? ' active' : ''}`}
            aria-label='Grid view'
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
          >
            <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor'>
              <rect x='3' y='3' width='8' height='8' rx='1.5' />
              <rect x='13' y='3' width='8' height='8' rx='1.5' />
              <rect x='3' y='13' width='8' height='8' rx='1.5' />
              <rect x='13' y='13' width='8' height='8' rx='1.5' />
            </svg>
          </button>
          <button
            type='button'
            class={`seg-btn${view === 'list' ? ' active' : ''}`}
            aria-label='List view'
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor'>
              <circle cx='4' cy='6' r='1.5' />
              <circle cx='4' cy='12' r='1.5' />
              <circle cx='4' cy='18' r='1.5' />
              <rect x='8' y='5' width='13' height='2' rx='1' />
              <rect x='8' y='11' width='13' height='2' rx='1' />
              <rect x='8' y='17' width='13' height='2' rx='1' />
            </svg>
          </button>
        </div>

        <button type='button' class='btn btn-primary btn-add' onClick={() => navigate('/publish')}>
          Add new
        </button>
      </div>

      {notice && <StatusLine kind={notice.kind} text={notice.text} />}
      {listError && <StatusLine kind='error' text={listError} />}

      {visible === null ? (
        <div class='products grid'>
          <div class='card card-skeleton' />
          <div class='card card-skeleton' />
          <div class='card card-skeleton' />
        </div>
      ) : visible.length === 0 ? (
        <div class='empty-state'>
          {q ? (
            <>
              <h3>No matches</h3>
              <p>No products match “{q}”.</p>
            </>
          ) : (
            <p>Add a domain and it will appear here.</p>
          )}
        </div>
      ) : (
        <div class={`products ${view}`}>
          {visible.map((domain) => {
            const unpublishing = pending === `unpublish:${domain.label}`
            const open = menuFor === domain.label
            return (
              <ProductCard
                key={domain.label}
                domain={domain}
                unpublishing={unpublishing}
                menu={
                  <div class='card-menu'>
                    <button
                      type='button'
                      class='icon-btn'
                      aria-label='Actions'
                      disabled={pending !== null}
                      onClick={() => setMenuFor(open ? null : domain.label)}
                    >
                      <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor'>
                        <circle cx='5' cy='12' r='1.6' />
                        <circle cx='12' cy='12' r='1.6' />
                        <circle cx='19' cy='12' r='1.6' />
                      </svg>
                    </button>
                    {open && (
                      <div class='menu'>
                        <a
                          class='menu-item'
                          href={`https://${domain.label}.${WEB_DOMAIN}`}
                          target='_blank'
                          rel='noreferrer'
                          onClick={closeMenu}
                        >
                          Open
                        </a>
                        <button
                          type='button'
                          class='menu-item'
                          onClick={() => navigate(`/d/${domain.label}`)}
                        >
                          Settings
                        </button>
                        {domain.publication &&
                          (confirming === `unpublish:${domain.label}` ? (
                            <button
                              type='button'
                              class='menu-item menu-danger'
                              onClick={() => void runUnpublish(domain.label)}
                            >
                              Confirm unpublish
                            </button>
                          ) : (
                            <button
                              type='button'
                              class='menu-item menu-danger'
                              onClick={() => setConfirming(`unpublish:${domain.label}`)}
                            >
                              Unpublish
                            </button>
                          ))}
                        {confirming === `remove:${domain.label}` ? (
                          <button
                            type='button'
                            class='menu-item menu-danger'
                            onClick={() => void runRemove(domain.label)}
                          >
                            Confirm remove
                          </button>
                        ) : (
                          <button
                            type='button'
                            class='menu-item menu-danger'
                            onClick={() => setConfirming(`remove:${domain.label}`)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
