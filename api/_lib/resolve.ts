/**
 * Shared read-only agent resolution logic for /api/agent and /api/agent/paid.
 * Pure data: no wallet, no signing, no write operations.
 * arc-studio-allow-onchain-literal
 */

import { NETWORK_CONFIGS, identityAbi, reputationAbi, validationAbi } from './networks.js'
import { getClient } from './rpc.js'
import { fetchIpfsJson } from './ipfs.js'
import type { AgentResponse, FeedbackRecord, ValidationRequest, AgentMetadata } from './types.js'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

function formatScore(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString()
  const s = value.toString().replace('-', '')
  const neg = value < 0n
  const padded = s.padStart(decimals + 1, '0')
  const int = padded.slice(0, padded.length - decimals) || '0'
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '')
  const result = frac ? `${int}.${frac}` : int
  return neg ? `-${result}` : result
}

export type ResolveResult =
  | { ok: true;  data: AgentResponse }
  | { ok: false; status: 404 | 503;  error: string; message: string }

/**
 * Resolve a single ERC-8004 agent. Returns the full AgentResponse on success
 * or a typed error object on failure. No HTTP concerns here — callers map to
 * their own response format.
 */
export async function resolveAgent(
  networkKey: 'mainnet' | 'testnet',
  agentId: number,
  agentIdBig: bigint,
): Promise<ResolveResult> {
  const cfg    = NETWORK_CONFIGS[networkKey]
  const client = getClient(networkKey)

  // ── Identity reads ────────────────────────────────────────────────────────
  let owner: string, agentWallet: string, metadataUri: string
  try {
    const [ownerResult, walletResult, uriResult] = await Promise.all([
      client.readContract({ address: cfg.identityRegistry, abi: identityAbi, functionName: 'ownerOf',        args: [agentIdBig] }),
      client.readContract({ address: cfg.identityRegistry, abi: identityAbi, functionName: 'getAgentWallet', args: [agentIdBig] }),
      client.readContract({ address: cfg.identityRegistry, abi: identityAbi, functionName: 'tokenURI',       args: [agentIdBig] }),
    ])
    owner       = ownerResult  as string
    agentWallet = walletResult as string
    metadataUri = uriResult    as string
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isNotFound =
      (err as { cause?: { data?: { errorName?: string } } })?.cause?.data?.errorName === 'ERC721NonexistentToken'
      || msg.includes('NonexistentToken')
      || msg.includes('invalid token')
      || msg.includes('does not exist')
      || msg.includes('ERC721')
    if (isNotFound) {
      return { ok: false, status: 404, error: 'not_found', message: `Agent #${agentId} not found on ${cfg.label}` }
    }
    console.error('[resolveAgent] identity read failed:', msg)
    return { ok: false, status: 503, error: 'rpc_error', message: `RPC call failed for ${cfg.label}: ${msg}` }
  }

  // ── IPFS metadata fetch (non-fatal) ───────────────────────────────────────
  let metadata: AgentMetadata | null = null
  let metadataError: string | null = null
  if (metadataUri) {
    const result = await fetchIpfsJson(metadataUri)
    if (result.data !== null) {
      metadata = result.data as AgentMetadata
    } else {
      metadataError = result.error
    }
  }

  // ── Reputation reads ──────────────────────────────────────────────────────
  let clientCount    = 0
  let feedbackCount  = 0
  let aggregateScore: string | null = null
  let clients: string[] = []
  const feedbackRecords: FeedbackRecord[] = []

  try {
    clients     = (await client.readContract({
      address: cfg.reputationRegistry, abi: reputationAbi,
      functionName: 'getClients', args: [agentIdBig],
    })) as string[]
    clientCount = clients.length

    if (clients.length > 0) {
      const [summary, feedback] = await Promise.all([
        client.readContract({
          address: cfg.reputationRegistry, abi: reputationAbi,
          functionName: 'getSummary', args: [agentIdBig, clients as `0x${string}`[], '', ''],
        }),
        client.readContract({
          address: cfg.reputationRegistry, abi: reputationAbi,
          functionName: 'readAllFeedback', args: [agentIdBig, [] as `0x${string}`[], '', '', false],
        }),
      ])
      const [count, summaryValue, summaryDecimals] = summary as [bigint, bigint, number]
      feedbackCount  = Number(count)
      aggregateScore = feedbackCount > 0 ? formatScore(summaryValue, summaryDecimals) : null

      const [fbClients, fbIndexes, fbValues, fbDecimals, fbTag1s, fbTag2s, fbRevoked] =
        feedback as [string[], bigint[], bigint[], number[], string[], string[], boolean[]]
      for (let i = 0; i < (fbClients?.length ?? 0); i++) {
        feedbackRecords.push({
          client:        fbClients[i],
          feedbackIndex: Number(fbIndexes[i]),
          value:         formatScore(fbValues[i], fbDecimals[i]),
          tag1:          fbTag1s[i]  || null,
          tag2:          fbTag2s[i]  || null,
          isRevoked:     fbRevoked[i],
        })
      }
    }
  } catch (err) {
    // Reputation read failure is non-fatal — return what we have
    console.error('[resolveAgent] reputation read failed:', err instanceof Error ? err.message : err)
  }

  // ── Validation reads ──────────────────────────────────────────────────────
  const validationRequests: ValidationRequest[] = []
  let validationAvailable = false
  let validationReason: string | null    = null
  let requestCount: number | null        = null

  if (cfg.validationRegistry === null) {
    validationReason = 'Validation registry not deployed on this network'
  } else {
    validationAvailable = true
    try {
      const hashes = (await client.readContract({
        address: cfg.validationRegistry, abi: validationAbi,
        functionName: 'getAgentValidations', args: [agentIdBig],
      })) as `0x${string}`[]
      requestCount = hashes.length

      await Promise.all(hashes.map(async (hash) => {
        try {
          const status = await client.readContract({
            address: cfg.validationRegistry as `0x${string}`, abi: validationAbi,
            functionName: 'getValidationStatus', args: [hash],
          }) as [string, bigint, number, string, string, bigint]
          const [validatorAddress, , response, responseHash, tag, lastUpdate] = status
          const hasResponse = responseHash !== ZERO_BYTES32
          validationRequests.push({
            requestHash:      hash,
            validatorAddress,
            response,
            responseHash,
            hasResponse,
            tag:              tag || null,
            lastUpdate:       Number(lastUpdate),
            lastUpdateIso:    new Date(Number(lastUpdate) * 1000).toISOString(),
          })
        } catch {
          // individual status fetch failure — skip this hash
        }
      }))
    } catch (err) {
      console.error('[resolveAgent] validation read failed:', err instanceof Error ? err.message : err)
      validationReason = 'Validation read failed'
    }
  }

  // ── Build and return ──────────────────────────────────────────────────────
  const data: AgentResponse = {
    agentId,
    network: networkKey,
    chainId: cfg.chainId,
    identity: {
      owner,
      agentWallet,
      metadataUri,
      registries: {
        identity:   cfg.identityRegistry,
        reputation: cfg.reputationRegistry,
        validation: cfg.validationRegistry,
      },
    },
    metadata,
    metadataError,
    reputation: {
      clientCount,
      feedbackCount,
      aggregateScore,
      clients,
      feedback: feedbackRecords,
    },
    validation: {
      available:    validationAvailable,
      reason:       validationReason,
      requestCount,
      requests:     validationRequests,
    },
    links: {
      explorer:        cfg.explorerBase,
      agentOnExplorer: `https://arcagents.app/agent/${agentId}?network=${networkKey}`,
    },
    fetchedAt: new Date().toISOString(),
  }

  return { ok: true, data }
}
