/**
 * Arc ERC-8004 Explorer
 * Supports Arc Testnet (Agent #876991) and Arc Mainnet (Agent #15).
 * All data is read-only from the live registries. No wallet connection required.
 * To add future networks: add an entry to NETWORK_CONFIGS below.
 */

import { useReadContract, useReadContracts } from 'wagmi'
import { useState, useEffect, useCallback } from 'react'
import { requireChain, buildAddressExplorerUrl } from '@/onchain-facts'

// ─── Network configs ──────────────────────────────────────────────────────────

interface NetworkConfig {
  label: string
  chainId: number
  agentId: bigint
  identityRegistry:   `0x${string}`
  reputationRegistry: `0x${string}`
  validationRegistry: `0x${string}` | null
}

const NETWORK_CONFIGS: NetworkConfig[] = [
  {
    label:              'Arc Mainnet',
    chainId:            5042,
    agentId:            15n,
    identityRegistry:   '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    validationRegistry: null,
  },
  {
    label:              'Arc Testnet',
    chainId:            5042002,
    agentId:            876991n,
    identityRegistry:   '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
  },
]

// ─── ABIs (read-only subset) ──────────────────────────────────────────────────

const identityAbi = [
  { type: 'function', name: 'ownerOf',        stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'getAgentWallet',  stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'tokenURI',        stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string'  }] },
] as const

const reputationAbi = [
  { type: 'function', name: 'getClients', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'address[]' }] },
  {
    type: 'function', name: 'getSummary', stateMutability: 'view',
    inputs: [
      { name: 'agentId',         type: 'uint256'   },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1',            type: 'string'    },
      { name: 'tag2',            type: 'string'    },
    ],
    outputs: [
      { name: 'count',                type: 'uint64'  },
      { name: 'summaryValue',         type: 'int128'  },
      { name: 'summaryValueDecimals', type: 'uint8'   },
    ],
  },
  {
    type: 'function', name: 'readAllFeedback', stateMutability: 'view',
    inputs: [
      { name: 'agentId',         type: 'uint256'   },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1',            type: 'string'    },
      { name: 'tag2',            type: 'string'    },
      { name: 'includeRevoked',  type: 'bool'      },
    ],
    outputs: [
      { name: 'clients',         type: 'address[]' },
      { name: 'feedbackIndexes', type: 'uint64[]'  },
      { name: 'values',          type: 'int128[]'  },
      { name: 'valueDecimals',   type: 'uint8[]'   },
      { name: 'tag1s',           type: 'string[]'  },
      { name: 'tag2s',           type: 'string[]'  },
      { name: 'revokedStatuses', type: 'bool[]'    },
    ],
  },
] as const

const validationAbi = [
  { type: 'function', name: 'getAgentValidations', stateMutability: 'view',
    inputs:  [{ name: 'agentId',     type: 'uint256' }],
    outputs: [{ name: 'requestHashes', type: 'bytes32[]' }] },
  { type: 'function', name: 'getValidationStatus', stateMutability: 'view',
    inputs:  [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId',          type: 'uint256' },
      { name: 'response',         type: 'uint8'   },
      { name: 'responseHash',     type: 'bytes32' },
      { name: 'tag',              type: 'string'  },
      { name: 'lastUpdate',       type: 'uint256' },
    ] },
] as const

// ─── Types ────────────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortenAddress(addr: string) { return `${addr.slice(0, 6)}…${addr.slice(-4)}` }

const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
]

function ipfsToHttp(uri: string, gatewayIndex = 0): string {
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice(7)
    return `${IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length]}${cid}`
  }
  return uri
}

function formatScore(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString()
  const d = BigInt(10 ** decimals)
  return `${value / d}.${(value % d).toString().padStart(decimals, '0')}`
}

// ─── Design tokens ────────────────────────────────────────────────────────────

// Base palette
const T = {
  // Backgrounds
  bg:        '#07101c',
  bgNav:     'rgba(7,16,28,0.94)',
  bgCard:    'rgba(255,255,255,0.038)',
  bgHero:    'rgba(255,255,255,0.052)',
  bgInner:   'rgba(255,255,255,0.030)',
  bgWell:    'rgba(255,255,255,0.022)',

  // Borders
  border:    'rgba(255,255,255,0.075)',
  borderMid: 'rgba(255,255,255,0.10)',

  // Text
  ink:       '#eef2f7',
  ink2:      '#8a9ab0',
  ink3:      '#4a5a6e',
  ink4:      '#2e3a48',

  // Semantic
  green:     '#4ade80',
  greenDim:  'rgba(74,222,128,0.09)',
  greenB:    'rgba(74,222,128,0.20)',
  red:       '#f87171',
  redDim:    'rgba(248,113,113,0.08)',
  redB:      'rgba(248,113,113,0.18)',

  // Fonts
  mono:    "'JetBrains Mono', 'Fira Mono', Menlo, monospace",
  display: "'Space Grotesk', sans-serif",
  body:    "'DM Sans', sans-serif",
}

// Network-aware accent — call once in AgentDashboard, thread down
function getAccent(isMainnet: boolean) {
  return isMainnet
    ? { color: '#e8a430', dim: 'rgba(232,164,48,0.10)', border: 'rgba(232,164,48,0.24)', glow: 'rgba(232,164,48,0.08)' }
    : { color: '#60a5fa', dim: 'rgba(96,165,250,0.10)', border: 'rgba(96,165,250,0.22)', glow: 'rgba(96,165,250,0.08)' }
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Skeleton({ w = '68%', h = 12 }: { w?: string; h?: number }) {
  return (
    <span className="animate-pulse" style={{
      display: 'inline-block', height: h, width: w, borderRadius: 5,
      background: 'rgba(255,255,255,0.065)', verticalAlign: 'middle',
    }} />
  )
}

function Divider() {
  return <div style={{ height: 1, background: T.border, margin: '0' }} />
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'block', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.09em', textTransform: 'uppercase',
      color: T.ink3, fontFamily: T.body, marginBottom: 5,
    }}>
      {children}
    </span>
  )
}

function Badge({
  children, color = T.ink3, bg = T.bgInner, border = T.border,
}: { children: React.ReactNode; color?: string; bg?: string; border?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 100,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      color, background: bg, border: `1px solid ${border}`,
      fontFamily: T.body, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function AddrChip({ address, chainId, accent }: { address: string; chainId: number; accent: ReturnType<typeof getAccent> }) {
  const url = buildAddressExplorerUrl(chainId, address)
  const [hov, setHov] = useState(false)
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '4px 10px', borderRadius: 7, textDecoration: 'none',
        fontFamily: T.mono, fontSize: 12, fontWeight: 500, letterSpacing: '0.01em',
        color: accent.color,
        background: hov ? accent.dim : 'rgba(255,255,255,0.035)',
        border: `1px solid ${hov ? accent.border : T.border}`,
        transition: 'all 0.12s',
      }}
    >
      <span className="tabular-nums">{shortenAddress(address)}</span>
      <span style={{ opacity: 0.55, fontSize: 10 }}>↗</span>
    </a>
  )
}


function Card({ children, hero = false, accent, style: s }: {
  children: React.ReactNode
  hero?: boolean
  accent?: ReturnType<typeof getAccent>
  style?: React.CSSProperties
}) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: hero ? T.bgHero : T.bgCard,
      border: `1px solid ${hero && accent ? accent.border : T.border}`,
      borderRadius: 14,
      ...s,
    }}>
      {hero && accent && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: `linear-gradient(90deg, transparent 0%, ${accent.color}55 40%, ${accent.color}55 60%, transparent 100%)`,
        }} />
      )}
      {children}
    </div>
  )
}

function CardSection({ children, style: s }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="aex-card-section" style={{ padding: '18px 20px', ...s }}>{children}</div>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
      color: T.ink3, fontFamily: T.body, marginBottom: 16,
    }}>
      <span style={{ display: 'inline-block', width: 12, height: 1, background: T.border, flexShrink: 0 }} />
      {children}
      <span style={{ flex: 1, height: 1, background: T.border }} />
    </div>
  )
}

function DataRow({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '13px 0',
      }}>
        <Label>{label}</Label>
        <div style={{ fontSize: 13, fontWeight: 500, color: T.ink2, lineHeight: 1.55, fontFamily: T.body }}>
          {children}
        </div>
      </div>
      {!last && <Divider />}
    </div>
  )
}

function StatTile({ label, value, accent }: {
  label: string
  value: React.ReactNode
  accent?: ReturnType<typeof getAccent>
}) {
  return (
    <div style={{
      background: accent ? accent.dim : T.bgInner,
      border: `1px solid ${accent ? accent.border : T.border}`,
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: accent ? accent.color : T.ink3, fontFamily: T.body,
      }}>
        {label}
      </span>
      <div style={{
        fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.1,
        color: T.ink, fontFamily: T.display,
      }} className="tabular-nums">
        {value}
      </div>
    </div>
  )
}

function Well({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '13px 15px', borderRadius: 9, marginTop: 2,
      background: T.bgWell, border: `1px solid ${T.border}`,
      fontSize: 12, color: T.ink3, fontFamily: T.body, lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}

function ErrorWell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '11px 14px', borderRadius: 9, marginTop: 2,
      background: T.redDim, border: `1px solid ${T.redB}`,
      fontSize: 12, color: T.red, fontFamily: T.body, lineHeight: 1.5,
    }}>
      <span style={{ flexShrink: 0, fontWeight: 700 }}>!</span>
      {children}
    </div>
  )
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ value, accent }: { value: string; accent: ReturnType<typeof getAccent> }) {
  const [state, setState] = useState<'idle' | 'copied'>('idle')
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setState('copied')
      setTimeout(() => setState('idle'), 1600)
    })
  }
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      style={{
        padding: '2px 7px', borderRadius: 5, cursor: 'pointer', flexShrink: 0,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
        fontFamily: T.body, lineHeight: 1,
        background: state === 'copied' ? T.greenDim : T.bgWell,
        border: `1px solid ${state === 'copied' ? T.greenB : T.border}`,
        color: state === 'copied' ? T.green : accent.color,
        transition: 'all 0.12s',
      }}
    >
      {state === 'copied' ? 'Copied' : 'Copy'}
    </button>
  )
}

// ─── Agent Details Panel ──────────────────────────────────────────────────────

interface AgentDetailsPanelProps {
  cfg: NetworkConfig
  activeAgentId: bigint
  chain: ReturnType<typeof requireChain>
  owner: string | undefined
  agentWallet: string | undefined
  agentURI: string | undefined
  accent: ReturnType<typeof getAccent>
}

function AgentDetailsPanel({ cfg, activeAgentId, chain, owner, agentWallet, agentURI, accent }: AgentDetailsPanelProps) {
  const [open, setOpen] = useState(false)

  // Each detail row: label + value (string) + optional href
  const rows: Array<{ label: string; value: string | undefined; href?: string; mono?: boolean }> = [
    { label: 'Agent ID',            value: activeAgentId.toString() },
    { label: 'Network',             value: chain.name },
    { label: 'Chain ID',            value: cfg.chainId.toString() },
    { label: 'Owner',               value: owner,      href: owner ? buildAddressExplorerUrl(cfg.chainId, owner) : undefined, mono: true },
    { label: 'Agent Wallet',        value: agentWallet, href: agentWallet ? buildAddressExplorerUrl(cfg.chainId, agentWallet) : undefined, mono: true },
    { label: 'Identity Registry',   value: cfg.identityRegistry,   href: buildAddressExplorerUrl(cfg.chainId, cfg.identityRegistry),   mono: true },
    { label: 'Reputation Registry', value: cfg.reputationRegistry, href: buildAddressExplorerUrl(cfg.chainId, cfg.reputationRegistry), mono: true },
    { label: 'Validation Registry', value: cfg.validationRegistry ?? 'Not deployed on this network', href: cfg.validationRegistry ? buildAddressExplorerUrl(cfg.chainId, cfg.validationRegistry) : undefined, mono: !!cfg.validationRegistry },
    { label: 'Metadata URI',        value: agentURI, href: agentURI ? ipfsToHttp(agentURI, 0) : undefined, mono: true },
  ]

  return (
    <Card style={{ marginBottom: 14 }}>
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.ink3, fontFamily: T.body }}>
          Agent Details
        </span>
        <span style={{
          fontSize: 14, color: open ? accent.color : T.ink3,
          transition: 'transform 0.18s, color 0.18s',
          display: 'inline-block',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          ▾
        </span>
      </button>

      {/* Expandable content */}
      {open && (
        <>
          <Divider />
          <div style={{ padding: '6px 20px 18px' }}>
            {rows.map(({ label, value, href, mono }, idx) => {
              const isLast = idx === rows.length - 1
              const isEmpty = value === undefined
              const muted = !value || value === 'Not deployed on this network'
              return (
                <div key={label}>
                  <div className="aex-detail-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0' }}>
                    {/* Label col */}
                    <span className="aex-detail-label" style={{
                      color: T.ink3, fontFamily: T.body,
                    }}>
                      {label}
                    </span>
                    {/* Value col */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      {isEmpty ? (
                        <Skeleton w="120px" />
                      ) : href ? (
                        <a
                          href={href} target="_blank" rel="noopener noreferrer"
                          style={{
                            flex: 1, minWidth: 0,
                            fontFamily: mono ? T.mono : T.body,
                            fontSize: mono ? 11 : 12,
                            color: muted ? T.ink3 : accent.color,
                            textDecoration: 'none',
                            wordBreak: 'break-all', lineHeight: 1.55,
                            display: 'flex', alignItems: 'flex-start', gap: 4,
                          }}
                        >
                          <span style={{ flex: 1 }}>{value}</span>
                          <span style={{ flexShrink: 0, opacity: 0.5, fontSize: 9, marginTop: 2 }}>↗</span>
                        </a>
                      ) : (
                        <span style={{
                          flex: 1, minWidth: 0,
                          fontFamily: mono ? T.mono : T.body,
                          fontSize: mono ? 11 : 12,
                          color: muted ? T.ink3 : T.ink2,
                          wordBreak: 'break-all', lineHeight: 1.55,
                        }}>
                          {value}
                        </span>
                      )}
                      {/* Copy button — only when there's a real value to copy */}
                      {!isEmpty && !muted && (
                        <CopyButton value={value} accent={accent} />
                      )}
                    </div>
                  </div>
                  {!isLast && <Divider />}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}

// ─── Network selector ─────────────────────────────────────────────────────────

function NetworkSelector({
  configs, activeIndex, onChange,
}: {
  configs: NetworkConfig[]
  activeIndex: number
  onChange: (i: number) => void
}) {
  return (
    <div style={{
      display: 'flex', gap: 2, padding: 2, borderRadius: 9,
      background: T.bgInner, border: `1px solid ${T.border}`,
    }}>
      {configs.map((cfg, i) => {
        const active = i === activeIndex
        const mn = !requireChain(cfg.chainId).isTestnet
        const ac = getAccent(mn)
        return (
          <button
            key={cfg.label}
            onClick={() => onChange(i)}
            className="aex-net-btn"
            style={{
              padding: '5px 14px', borderRadius: 7, cursor: 'pointer',
              fontSize: 11, fontWeight: 700, fontFamily: T.body, letterSpacing: '0.03em',
              background: active ? ac.dim : 'transparent',
              border: `1px solid ${active ? ac.border : 'transparent'}`,
              color: active ? ac.color : T.ink3,
              transition: 'all 0.13s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {mn && (
              <span style={{
                display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                background: active ? ac.color : T.ink4, flexShrink: 0,
              }} />
            )}
            {cfg.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Reputation section ───────────────────────────────────────────────────────

function ReputationSection({
  agentId, chainId, reputationRegistry, accent, onCount,
}: {
  agentId: bigint
  chainId: number
  reputationRegistry: `0x${string}`
  accent: ReturnType<typeof getAccent>
  onCount?: (n: number) => void
}) {
  const { data: clients, isLoading: clientsLoading, error: clientsError } = useReadContract({
    address: reputationRegistry, abi: reputationAbi, functionName: 'getClients', args: [agentId], chainId,
  })
  const hasClients = Array.isArray(clients) && clients.length > 0

  const { data: summary, isLoading: summaryLoading } = useReadContract({
    address: reputationRegistry, abi: reputationAbi, functionName: 'getSummary',
    args: [agentId, clients ?? [], '', ''], chainId, query: { enabled: hasClients },
  })

  // Single additional read: all feedback records (non-revoked) using empty clientAddresses
  // so the contract falls back to its internal _clients list. Gated on clients resolving
  // (not on hasClients) so it fires even when 0 clients, returning empty arrays instantly.
  const { data: allFeedback, isLoading: feedbackLoading, error: feedbackError } = useReadContract({
    address: reputationRegistry, abi: reputationAbi, functionName: 'readAllFeedback',
    args: [agentId, [], '', '', false], chainId,
    query: { enabled: !clientsLoading && !clientsError },
  })

  const isLoading = clientsLoading || (hasClients && summaryLoading) || feedbackLoading

  // allFeedback tuple: [clients[], feedbackIndexes[], values[], valueDecimals[], tag1s[], tag2s[], revokedStatuses[]]
  const feedbackRecords = !isLoading && !feedbackError && Array.isArray(allFeedback?.[0])
    ? (allFeedback[0] as readonly string[]).map((client, i) => ({
        client:        client as `0x${string}`,
        index:         Number((allFeedback[1])[i]),
        value:         (allFeedback[2])[i],
        decimals:      Number((allFeedback[3])[i]),
        tag1:          (allFeedback[4])[i] ?? '',
        tag2:          (allFeedback[5])[i] ?? '',
        isRevoked:     (allFeedback[6])[i] ?? false,
      }))
    : []

  const feedbackCount = !clientsLoading && !clientsError
    ? (hasClients && summary ? Number(summary[0]) : 0)
    : undefined
  useEffect(() => {
    if (feedbackCount !== undefined) onCount?.(feedbackCount)
  }, [feedbackCount, onCount])

  return (
    <Card>
      <CardSection>
        <SectionLabel>Reputation</SectionLabel>

        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <Skeleton /><Skeleton w="48%" />
          </div>
        )}
        {!isLoading && clientsError && <ErrorWell>Could not load reputation data.</ErrorWell>}

        {!isLoading && !clientsError && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 18 }}>
              <StatTile label="Clients"  value={clients ? clients.length : 0} />
              <StatTile label="Feedback" value={hasClients && summary ? summary[0].toString() : '0'} />
            </div>

            {hasClients && summary && (
              <DataRow label="Aggregate Score">
                <span className="tabular-nums" style={{
                  fontSize: 20, fontWeight: 700, fontFamily: T.display, letterSpacing: '-0.03em',
                  color: summary[1] >= 0n ? T.green : T.red,
                }}>
                  {summary[1] >= 0n ? '+' : ''}{formatScore(summary[1], summary[2])}
                </span>
              </DataRow>
            )}

            {/* Feedback records — empty today for both agents; renders automatically when feedback exists */}
            {feedbackRecords.length > 0 && (
              <DataRow label={`Feedback Records (${feedbackRecords.length})`} last={!hasClients}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  {feedbackRecords.map((fb) => (
                    <div key={`${fb.client}-${fb.index}`} style={{
                      background: T.bgWell, border: `1px solid ${T.border}`,
                      borderRadius: 9, padding: '11px 13px',
                    }}>
                      {/* Row: client + index */}
                      <div className="aex-val-row" style={{ marginBottom: 8 }}>
                        <AddrChip address={fb.client} chainId={chainId} accent={accent} />
                        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.ink3,
                          background: T.bgInner, border: `1px solid ${T.border}`,
                          borderRadius: 5, padding: '2px 7px', flexShrink: 0 }}>
                          #{fb.index}
                        </span>
                      </div>
                      {/* Score */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 15, fontWeight: 700, fontFamily: T.display,
                          letterSpacing: '-0.02em',
                          color: fb.value >= 0n ? T.green : T.red,
                        }} className="tabular-nums">
                          {fb.value >= 0n ? '+' : ''}{formatScore(fb.value, fb.decimals)}
                        </span>
                        {fb.tag1 && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: accent.color,
                            background: accent.dim, border: `1px solid ${accent.border}`,
                            borderRadius: 5, padding: '2px 8px' }}>
                            {fb.tag1}
                          </span>
                        )}
                        {fb.tag2 && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: T.ink3,
                            background: T.bgInner, border: `1px solid ${T.border}`,
                            borderRadius: 5, padding: '2px 8px' }}>
                            {fb.tag2}
                          </span>
                        )}
                        {fb.isRevoked && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: T.red,
                            background: T.redDim, border: `1px solid ${T.redB}`,
                            borderRadius: 5, padding: '2px 8px' }}>
                            Revoked
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </DataRow>
            )}

            {feedbackError && (
              <ErrorWell>Could not load feedback records.</ErrorWell>
            )}

            {!hasClients && (
              <Well>
                No reputation feedback recorded yet.
                <span style={{ display: 'block', marginTop: 2, color: T.ink4 }}>
                  Clients who hire this agent will leave feedback here.
                </span>
              </Well>
            )}

            {hasClients && (
              <DataRow label="Client Addresses" last>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {(clients as readonly `0x${string}`[]).map(addr => (
                    <AddrChip key={addr} address={addr} chainId={chainId} accent={accent} />
                  ))}
                </div>
              </DataRow>
            )}
          </>
        )}
      </CardSection>
    </Card>
  )
}

// ─── Validation detail (per-hash) ─────────────────────────────────────────────

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

function ValidationDetail({
  hash, chainId, validationRegistry, accent,
}: {
  hash: `0x${string}`
  chainId: number
  validationRegistry: `0x${string}`
  accent: ReturnType<typeof getAccent>
}) {
  const { data, isLoading, error } = useReadContract({
    address: validationRegistry, abi: validationAbi,
    functionName: 'getValidationStatus', args: [hash], chainId,
  })

  // data tuple: [validatorAddress, agentId, response, responseHash, tag, lastUpdate]
  const validatorAddress = data ? (data[0] as string)        : undefined
  const response         = data ? Number(data[2])            : undefined
  const responseHash     = data ? (data[3] as string)        : undefined
  const tag              = data ? (data[4])        : undefined
  const lastUpdate       = data ? Number(data[5])            : undefined

  const hasResponse = responseHash !== undefined && responseHash !== ZERO_BYTES32
  const lastUpdateDate = lastUpdate
    ? new Date(lastUpdate * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : undefined

  return (
    <div style={{
      background: T.bgWell, border: `1px solid ${T.border}`,
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      {/* Request hash — display only, no /tx/ link (not a tx hash) */}
      <div className="aex-val-row" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.ink3, fontFamily: T.body }}>
          Request Hash
        </span>
        <span style={{
          fontFamily: T.mono, fontSize: 11, color: T.ink2,
          letterSpacing: '0.01em', wordBreak: 'break-all', textAlign: 'right', flex: 1, minWidth: 0,
        }}>
          {hash.slice(0, 14)}…{hash.slice(-8)}
        </span>
      </div>

      <Divider />

      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12 }}>
          <Skeleton /><Skeleton w="55%" /><Skeleton w="40%" />
        </div>
      )}

      {!isLoading && error && (
        <div style={{ paddingTop: 10 }}>
          <ErrorWell>Could not load validation status.</ErrorWell>
        </div>
      )}

      {!isLoading && !error && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingTop: 4 }}>

          {/* Status badge */}
          <div className="aex-val-row" style={{ padding: '9px 0' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.ink3, fontFamily: T.body }}>Status</span>
            <Badge
              color={hasResponse ? T.green : accent.color}
              bg={hasResponse ? T.greenDim : accent.dim}
              border={hasResponse ? T.greenB : accent.border}
            >
              {hasResponse ? (
                <>
                  <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: T.green }} />
                  Responded
                </>
              ) : (
                <>
                  <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: accent.color }} />
                  Pending
                </>
              )}
            </Badge>
          </div>
          <Divider />

          {/* Validator address */}
          <div className="aex-val-row" style={{ padding: '9px 0' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.ink3, fontFamily: T.body, flexShrink: 0 }}>Validator</span>
            {validatorAddress
              ? <AddrChip address={validatorAddress} chainId={chainId} accent={accent} />
              : <Skeleton w="140px" />}
          </div>
          <Divider />

          {/* Response score — only when hasResponse */}
          {hasResponse && response !== undefined && (
            <>
              <div className="aex-val-row" style={{ padding: '9px 0' }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.ink3, fontFamily: T.body }}>Score</span>
                <span style={{ fontFamily: T.display, fontSize: 18, fontWeight: 700, color: T.ink, letterSpacing: '-0.03em' }} className="tabular-nums">
                  {response}<span style={{ fontSize: 11, color: T.ink3, fontWeight: 500 }}>/100</span>
                </span>
              </div>
              <Divider />
            </>
          )}

          {/* Tag — only when non-empty */}
          {tag !== undefined && tag !== '' && (
            <>
              <div className="aex-val-row" style={{ padding: '9px 0' }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.ink3, fontFamily: T.body }}>Tag</span>
                <Badge>{tag}</Badge>
              </div>
              <Divider />
            </>
          )}

          {/* Last update */}
          <div className="aex-val-row" style={{ padding: '9px 0' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.ink3, fontFamily: T.body }}>Last Update</span>
            <span style={{ fontSize: 12, color: T.ink2, fontFamily: T.body }}>
              {lastUpdateDate ?? <Skeleton w="120px" />}
            </span>
          </div>

        </div>
      )}
    </div>
  )
}

// ─── Validation section ───────────────────────────────────────────────────────

function ValidationSection({
  agentId, chainId, validationRegistry, accent, onCount,
}: {
  agentId: bigint
  chainId: number
  validationRegistry: `0x${string}`
  accent: ReturnType<typeof getAccent>
  onCount?: (n: number) => void
}) {
  const { data: requestHashes, isLoading, error } = useReadContract({
    address: validationRegistry, abi: validationAbi, functionName: 'getAgentValidations', args: [agentId], chainId,
  })
  const count = Array.isArray(requestHashes) ? requestHashes.length : 0

  useEffect(() => {
    if (!isLoading && !error) onCount?.(count)
  }, [count, isLoading, error, onCount])

  return (
    <Card>
      <CardSection>
        <SectionLabel>Validation</SectionLabel>

        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <Skeleton /><Skeleton w="48%" />
          </div>
        )}
        {!isLoading && error && <ErrorWell>Could not load validation data.</ErrorWell>}

        {!isLoading && !error && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: count > 0 ? 18 : 0 }}>
              <StatTile
                label="Requests" value={count}
                accent={count > 0 ? accent : undefined}
              />
            </div>

            {count === 0 && <Well>No validation requests recorded for this agent.</Well>}

            {count > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(requestHashes as readonly `0x${string}`[]).map(hash => (
                  <ValidationDetail
                    key={hash}
                    hash={hash}
                    chainId={chainId}
                    validationRegistry={validationRegistry}
                    accent={accent}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardSection>
    </Card>
  )
}

// ─── URL deep-link helpers ────────────────────────────────────────────────────

/** Parse /agent/{id}?network=mainnet|testnet from the current URL. */
function parseDeepLink(): { agentId: bigint; networkKey: 'mainnet' | 'testnet' } | null {
  try {
    const m = window.location.pathname.match(/^\/agent\/(\d+)$/)
    if (!m) return null
    const agentId = BigInt(m[1])
    const raw = new URLSearchParams(window.location.search).get('network') ?? ''
    const networkKey: 'mainnet' | 'testnet' = raw.toLowerCase() === 'testnet' ? 'testnet' : 'mainnet'
    return { agentId, networkKey }
  } catch {
    return null
  }
}

/** Push /agent/{id}?network=mainnet|testnet to the browser history. */
function pushDeepLink(agentId: bigint, networkKey: 'mainnet' | 'testnet') {
  const url = `/agent/${agentId}?network=${networkKey}`
  window.history.pushState({}, '', url)
}

/** Clear the URL back to / without a page reload. */
function clearDeepLink() {
  window.history.replaceState({}, '', '/')
}

// ─── Example chips ────────────────────────────────────────────────────────────

interface ExampleChip { label: string; agentId: bigint; networkIndex: number }

const EXAMPLE_CHIPS: ExampleChip[] = [
  { label: '#8 · Mainnet',  agentId: 8n,  networkIndex: 0 },
  { label: '#98 · Testnet', agentId: 98n, networkIndex: 1 },
]

function ExampleChips({
  onSelect,
  accent,
}: {
  onSelect: (chip: ExampleChip) => void
  accent: ReturnType<typeof getAccent>
}) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 4,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color: T.ink3, letterSpacing: '0.05em',
        textTransform: 'uppercase', alignSelf: 'center', fontFamily: T.body, flexShrink: 0,
      }}>Try:</span>
      {EXAMPLE_CHIPS.map(chip => (
        <button
          key={chip.label}
          onClick={() => onSelect(chip)}
          style={{
            padding: '3px 10px', borderRadius: 20,
            background: T.bgWell, border: `1px solid ${T.border}`,
            color: T.ink2, fontFamily: T.mono, fontSize: 11,
            cursor: 'pointer', transition: 'all 0.12s',
            letterSpacing: '0.01em', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = accent.border
            e.currentTarget.style.color = accent.color
            e.currentTarget.style.background = accent.dim
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = T.border
            e.currentTarget.style.color = T.ink2
            e.currentTarget.style.background = T.bgWell
          }}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}

// ─── Search bar ───────────────────────────────────────────────────────────────

interface SearchBarProps {
  value: string
  onChange: (v: string) => void
  onSearch: () => void
  onExampleSelect: (chip: ExampleChip) => void
  pending: boolean
  error: string | null
  notFound: boolean
  searchedId: bigint | null
  networkLabel: string
  accent: ReturnType<typeof getAccent>
}

function SearchBar({ value, onChange, onSearch, onExampleSelect, pending, error, notFound, searchedId, networkLabel, accent }: SearchBarProps) {
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSearch()
  }

  // Inline message: validation error > not-found > null
  const msg: { text: string; color: string } | null =
    error      ? { text: error, color: T.ink3 } :
    notFound   ? { text: `Agent #${searchedId?.toString()} not found on ${networkLabel}`, color: T.ink3 } :
    null

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Label row */}
      <div className="aex-search-label" style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
        color: T.ink3, marginBottom: 8, fontFamily: T.body,
      }}>
        Find an ERC-8004 Agent &nbsp;·&nbsp; Search on {networkLabel}
      </div>

      {/* Input + button row */}
      <div className="aex-search-row">
        <input
          type="text"
          inputMode="numeric"
          placeholder={`Enter Agent ID, e.g. ${networkLabel.includes('Mainnet') ? '14' : '876978'}`}
          value={value}
          onChange={e => { onChange(e.target.value); }}
          onKeyDown={handleKey}
          disabled={pending}
          style={{
            flex: 1, minWidth: 0,
            height: 38, padding: '0 14px',
            background: T.bgInner,
            border: `1px solid ${error || notFound ? 'rgba(255,80,80,0.35)' : T.border}`,
            borderRadius: 9,
            color: T.ink, fontFamily: T.mono, fontSize: 13,
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={e  => { e.currentTarget.style.borderColor = accent.border }}
          onBlur={e   => { e.currentTarget.style.borderColor = (error || notFound) ? 'rgba(255,80,80,0.35)' : T.border }}
        />
        <button
          onClick={onSearch}
          disabled={pending}
          className="aex-search-btn"
          style={{
            height: 38, padding: '0 18px', flexShrink: 0,
            background: pending ? T.bgInner : accent.dim,
            border: `1px solid ${accent.border}`,
            borderRadius: 9, cursor: pending ? 'not-allowed' : 'pointer',
            color: pending ? T.ink3 : accent.color,
            fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
            fontFamily: T.body,
            transition: 'all 0.12s',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? '…' : 'Search'}
        </button>
      </div>

      {/* Inline message */}
      {msg && (
        <div style={{
          marginTop: 7, fontSize: 11, color: msg.color, fontFamily: T.body, lineHeight: 1.4,
        }}>
          {msg.text}
        </div>
      )}

      {/* Example chips */}
      <ExampleChips onSelect={onExampleSelect} accent={accent} />
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function AgentDashboard() {
  // ── Deep-link: parse URL on first mount ───────────────────────────────────
  const initialLink = parseDeepLink()
  const initialNetworkIndex = initialLink?.networkKey === 'testnet' ? 1 : 0

  const [networkIndex, setNetworkIndex] = useState(initialNetworkIndex)
  const cfg      = NETWORK_CONFIGS[networkIndex]
  const chain    = requireChain(cfg.chainId)
  const isMainnet = !chain.isTestnet
  const accent   = getAccent(isMainnet)

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchInput,  setSearchInput]  = useState(initialLink ? initialLink.agentId.toString() : '')
  const [searchedId,   setSearchedId]   = useState<bigint | null>(initialLink?.agentId ?? null)
  const [searchError,  setSearchError]  = useState<string | null>(null)

  // The agent currently being viewed: searched ID takes priority over the
  // configured Finder Agent for this network.
  const activeAgentId = searchedId ?? cfg.agentId

  // ── Counts ────────────────────────────────────────────────────────────────
  const [reputationCount, setReputationCount] = useState<number | undefined>(undefined)
  const [validationCount,  setValidationCount]  = useState<number | undefined>(undefined)

  // ── Validate + submit search ──────────────────────────────────────────────
  // Declared after counts so React Compiler sees them already initialized.
  const handleSearch = useCallback(() => {
    const trimmed = searchInput.trim()
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      setSearchError('Enter a valid numeric Agent ID')
      return
    }
    const parsed = BigInt(trimmed)
    setSearchError(null)
    setSearchedId(parsed)
    setReputationCount(undefined)
    setValidationCount(undefined)
    // Sync URL
    const nk: 'mainnet' | 'testnet' = NETWORK_CONFIGS[networkIndex].chainId === 5042 ? 'mainnet' : 'testnet'
    pushDeepLink(parsed, nk)
  }, [searchInput, networkIndex, setReputationCount, setValidationCount])

  const handleNetworkChange = (i: number) => {
    setNetworkIndex(i)
    setReputationCount(undefined)
    setValidationCount(undefined)
    setSearchInput('')
    setSearchedId(null)
    setSearchError(null)
    clearDeepLink()
  }

  // ── Home navigation ───────────────────────────────────────────────────────
  const handleHome = () => {
    setNetworkIndex(0)
    setReputationCount(undefined)
    setValidationCount(undefined)
    setSearchInput('')
    setSearchedId(null)
    setSearchError(null)
    clearDeepLink()
  }

  // ── Scroll-to-top visibility ──────────────────────────────────────────────
  const [showScrollTop, setShowScrollTop] = useState(false)
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Example chip handler ──────────────────────────────────────────────────
  const handleExampleSelect = (chip: ExampleChip) => {
    setNetworkIndex(chip.networkIndex)
    setSearchInput(chip.agentId.toString())
    setSearchedId(chip.agentId)
    setSearchError(null)
    setReputationCount(undefined)
    setValidationCount(undefined)
    const nk: 'mainnet' | 'testnet' = NETWORK_CONFIGS[chip.networkIndex].chainId === 5042 ? 'mainnet' : 'testnet'
    pushDeepLink(chip.agentId, nk)
  }

  const { data: identityData, isLoading: identityLoading, refetch } = useReadContracts({
    contracts: [
      { address: cfg.identityRegistry, abi: identityAbi, functionName: 'ownerOf',        args: [activeAgentId], chainId: cfg.chainId },
      { address: cfg.identityRegistry, abi: identityAbi, functionName: 'getAgentWallet', args: [activeAgentId], chainId: cfg.chainId },
      { address: cfg.identityRegistry, abi: identityAbi, functionName: 'tokenURI',       args: [activeAgentId], chainId: cfg.chainId },
    ],
  })

  // Detect not-found: ownerOf did not succeed while a search is active and
  // reads have settled. wagmi useReadContracts statuses are 'success' | 'failure'.
  const ownerResult = identityData?.[0]
  const notFound    = searchedId !== null && !identityLoading && ownerResult?.status === 'failure'

  // searchPending: a search was submitted and identity reads haven't settled yet
  const searchPending = searchedId !== null && identityLoading

  const owner       = ownerResult?.status === 'success' ? (ownerResult.result as string) : undefined
  const agentWallet = identityData?.[1]?.status === 'success' ? (identityData[1].result as string) : undefined
  const agentURI    = identityData?.[2]?.status === 'success' ? (identityData[2].result) : undefined

  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now())
  const [refreshing,  setRefreshing]  = useState(false)

  const handleRefresh = () => {
    setRefreshing(true)
    void refetch().finally(() => {
      setLastRefresh(Date.now())
      setRefreshing(false)
    })
  }

  const registryRows = [
    { label: 'Identity',   addr: cfg.identityRegistry   as string },
    { label: 'Reputation', addr: cfg.reputationRegistry as string },
    ...(cfg.validationRegistry ? [{ label: 'Validation', addr: cfg.validationRegistry as string }] : []),
  ]

  return (
    <div style={{ minHeight: '100dvh', background: T.bg, fontFamily: T.body, color: T.ink }}>

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <nav className="aex-nav" style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 18px',
        background: T.bgNav, backdropFilter: 'blur(18px)',
        borderBottom: `1px solid ${T.border}`,
      }}>
        {/* Left: wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={handleHome}
            onKeyDown={e => e.key === 'Enter' && handleHome()}
            title="Home"
            style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: `radial-gradient(circle at 38% 38%, ${accent.color}44, ${accent.color}08)`,
              border: `1px solid ${accent.border}`,
              cursor: 'pointer', transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontFamily: T.display, fontSize: 13, fontWeight: 700, color: T.ink, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              Arc ERC-8004 Explorer
            </span>
            <span style={{ fontSize: 9, color: T.ink3, fontWeight: 500, letterSpacing: '0.02em', lineHeight: 1 }}>
              Find and inspect agents on Arc
            </span>
          </div>
        </div>

        {/* Right: live + selector + refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 9px', borderRadius: 100,
            background: T.greenDim, border: `1px solid ${T.greenB}`,
            fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: '0.06em',
          }}>
            <span className="animate-pulse" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: T.green }} />
            LIVE
          </div>
          <NetworkSelector configs={NETWORK_CONFIGS} activeIndex={networkIndex} onChange={handleNetworkChange} />
          <button
            onClick={handleRefresh}
            title="Refresh onchain data"
            style={{
              width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
              background: refreshing ? accent.dim : T.bgInner,
              border: `1px solid ${refreshing ? accent.border : T.border}`,
              color: refreshing ? accent.color : T.ink3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, transition: 'all 0.12s',
            }}
          >
            ↺
          </button>
        </div>
      </nav>

      {/* ── BODY ────────────────────────────────────────────────────────── */}
      <div className="aex-content" style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 64px' }}>

        {/* ── SEARCH ────────────────────────────────────────────────────── */}
        <SearchBar
          value={searchInput}
          onChange={v => { setSearchInput(v); setSearchError(null) }}
          onSearch={handleSearch}
          onExampleSelect={handleExampleSelect}
          pending={searchPending || identityLoading}
          error={searchError}
          notFound={notFound}
          searchedId={searchedId}
          networkLabel={cfg.label}
          accent={accent}
        />

        {/* ── NOT FOUND STATE ──────────────────────────────────────────── */}
        {notFound && (
          <Card style={{ marginBottom: 14 }}>
            <CardSection>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 0 16px', textAlign: 'center' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: T.bgWell, border: `1px solid ${T.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, color: T.ink3,
                }}>?</div>
                <div style={{ fontFamily: T.display, fontSize: 16, fontWeight: 700, color: T.ink, letterSpacing: '-0.02em' }}>
                  Agent #{searchedId.toString()} not found
                </div>
                <div style={{ fontSize: 12, color: T.ink3, maxWidth: 320, lineHeight: 1.6 }}>
                  No ERC-8004 agent with this ID exists on {cfg.label}.
                  Try a different ID or{' '}
                  <button
                    onClick={() => { setSearchInput(''); setSearchedId(null); setSearchError(null) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent.color, fontSize: 12, padding: 0, fontFamily: T.body }}
                  >
                    return to the default agent
                  </button>.
                </div>
              </div>
            </CardSection>
          </Card>
        )}

        {/* ── MAIN CONTENT ──────────────────────────────────────────────── */}
        {!notFound && (<>

        {/* Tablet two-column grid: hero left, registries+details right */}
        <div className="aex-tablet-grid">

          {/* LEFT: hero card */}
          <div className="aex-tablet-left">
            <Card hero accent={accent}>

              {/* Agent header */}
              <CardSection style={{ paddingBottom: 16 }}>
                <div className="aex-hero-header">
                  {/* Avatar */}
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                    background: `linear-gradient(135deg, ${accent.color}28 0%, ${accent.color}08 100%)`,
                    border: `1.5px solid ${accent.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, fontFamily: T.mono, fontWeight: 700, color: accent.color,
                  }}>
                    AI
                  </div>
                  <div>
                    <div style={{
                      fontFamily: T.display, fontSize: 24, fontWeight: 700,
                      color: T.ink, letterSpacing: '-0.04em', lineHeight: 1.05,
                    }} className="tabular-nums">
                      Agent #{activeAgentId.toString()}
                    </div>
                    <div className="aex-badges" style={{ marginTop: 7 }}>
                      <Badge color={accent.color} bg={accent.dim} border={accent.border}>
                        ERC-8004 Identity
                      </Badge>
                      {isMainnet ? (
                        <Badge color={accent.color} bg={accent.dim} border={accent.border}>
                          Arc Mainnet
                        </Badge>
                      ) : (
                        <Badge>Arc Testnet</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardSection>

              <Divider />

              {/* Stats row */}
              <CardSection style={{ paddingTop: 16, paddingBottom: 16 }}>
                <div className="aex-stats-grid">
                  <StatTile label="Agent ID" value={activeAgentId.toString()} accent={accent} />
                  <StatTile
                    label="Reputation"
                    value={reputationCount !== undefined ? reputationCount : <Skeleton w="28px" h={18} />}
                  />
                  <StatTile
                    label="Validations"
                    value={
                      cfg.validationRegistry === null
                        ? <span style={{ fontSize: 10, color: T.ink3, letterSpacing: 0, lineHeight: 1.35 }}>ℹ Validation registry is not deployed on Arc Mainnet</span>
                        : validationCount !== undefined
                          ? validationCount
                          : <Skeleton w="28px" h={18} />
                    }
                    accent={cfg.validationRegistry !== null && validationCount !== undefined && validationCount > 0 ? accent : undefined}
                  />
                </div>
              </CardSection>

              <Divider />

              {/* Identity fields */}
              <CardSection style={{ paddingTop: 4, paddingBottom: 4 }}>
                <DataRow label="Owner">
                  {identityLoading
                    ? <Skeleton w="170px" />
                    : owner
                      ? <AddrChip address={owner} chainId={cfg.chainId} accent={accent} />
                      : <span style={{ color: T.ink3, fontSize: 12 }}>Not found</span>}
                </DataRow>
                <DataRow label="Agent Wallet" last>
                  {identityLoading
                    ? <Skeleton w="170px" />
                    : agentWallet
                      ? <AddrChip address={agentWallet} chainId={cfg.chainId} accent={accent} />
                      : <span style={{ color: T.ink3, fontSize: 12 }}>Not set</span>}
                </DataRow>
              </CardSection>
            </Card>
          </div>{/* end aex-tablet-left */}

          {/* RIGHT: registries + agent details */}
          <div className="aex-tablet-right">

            {/* Registries */}
            <Card>
              <CardSection>
                <SectionLabel>Registries</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {registryRows.map(({ label, addr }) => (
                    <div key={label} className="aex-registry-row" style={{
                      padding: '8px 12px', borderRadius: 8,
                      background: T.bgWell, border: `1px solid ${T.border}`,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.ink3, minWidth: 76, letterSpacing: '0.02em', flexShrink: 0 }}>{label}</span>
                      <AddrChip address={addr} chainId={cfg.chainId} accent={accent} />
                    </div>
                  ))}
                  {cfg.validationRegistry === null && (
                    <div className="aex-registry-row" style={{
                      padding: '8px 12px', borderRadius: 8,
                      background: T.bgWell, border: `1px solid ${T.border}`, opacity: 0.45,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.ink3, minWidth: 76 }}>Validation</span>
                      <span style={{ fontSize: 11, color: T.ink3 }}>Not deployed on this network</span>
                    </div>
                  )}
                </div>
              </CardSection>
            </Card>

            {/* Agent Details */}
            <AgentDetailsPanel
              key={`details-${cfg.chainId}-${activeAgentId}`}
              cfg={cfg}
              activeAgentId={activeAgentId}
              chain={chain}
              owner={owner}
              agentWallet={agentWallet}
              agentURI={agentURI}
              accent={accent}
            />

          </div>{/* end aex-tablet-right */}

        </div>{/* end aex-tablet-grid */}

        {/* FULL WIDTH: reputation + validation */}
        <div className="aex-tablet-full" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReputationSection
            key={`rep-${cfg.chainId}-${activeAgentId}`}
            agentId={activeAgentId}
            chainId={cfg.chainId}
            reputationRegistry={cfg.reputationRegistry}
            accent={accent}
            onCount={setReputationCount}
          />

          {cfg.validationRegistry !== null ? (
            <ValidationSection
              key={`val-${cfg.chainId}-${activeAgentId}`}
              agentId={activeAgentId}
              chainId={cfg.chainId}
              validationRegistry={cfg.validationRegistry}
              accent={accent}
              onCount={setValidationCount}
            />
          ) : (
            <Card key={`val-none-${cfg.chainId}`}>
              <CardSection>
                <SectionLabel>Validation</SectionLabel>
                <Well>ℹ Validation registry is not deployed on Arc Mainnet.</Well>
              </CardSection>
            </Card>
          )}
        </div>

        </>)}

        {/* ── FOOTER ────────────────────────────────────────────────────── */}
        <div style={{ marginTop: 32, textAlign: 'center', fontSize: 10, color: T.ink3, lineHeight: 2 }}>
          {chain.name} · Chain {cfg.chainId}
          <span style={{ margin: '0 7px', opacity: 0.3 }}>|</span>
          <a
            href={`${chain.explorerBase}/address/${cfg.identityRegistry}`}
            target="_blank" rel="noopener noreferrer"
            style={{ color: T.ink3, textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = accent.color)}
            onMouseLeave={e => (e.currentTarget.style.color = T.ink3)}
          >
            Explorer ↗
          </a>
          <span style={{ margin: '0 7px', opacity: 0.3 }}>|</span>
          Refreshed {new Date(lastRefresh).toLocaleTimeString()}
        </div>

        {/* ── FOOTER BAR ────────────────────────────────────────────────── */}
        <div className="aex-footer-bar">
          <span className="aex-footer-egg">Made with <span className="aex-footer-heart">♥</span> on Mars</span>
          <span className="aex-footer-links">
            <a
              href="https://github.com/Nomad07/arc-erc8004-explorer"
              target="_blank" rel="noopener noreferrer"
              className="aex-footer-link"
            >GitHub</a>
            <a
              href="https://x.com/nomadonmars"
              target="_blank" rel="noopener noreferrer"
              className="aex-footer-link"
            >X / Twitter</a>
          </span>
        </div>
      </div>

      {/* ── SCROLL TO TOP ───────────────────────────────────────────────── */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Back to top"
          style={{
            position: 'fixed', bottom: 56, right: 18, zIndex: 50,
            width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
            background: T.bgInner, border: `1px solid ${T.border}`,
            color: T.ink3, fontSize: 16, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = accent.dim
            e.currentTarget.style.borderColor = accent.border
            e.currentTarget.style.color = accent.color
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = T.bgInner
            e.currentTarget.style.borderColor = T.border
            e.currentTarget.style.color = T.ink3
          }}
        >↑</button>
      )}
    </div>
  )
}
