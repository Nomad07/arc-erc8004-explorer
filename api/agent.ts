/**
 * GET /api/agent?network=mainnet|testnet&agentId=<uint>
 *
 * Returns read-only ERC-8004 agent data for the requested agent on the
 * specified Arc network. Strictly no writes, no signing, no wallet connection.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { NETWORK_CONFIGS, identityAbi, reputationAbi, validationAbi } from './_lib/networks.js'
import { getClient } from './_lib/rpc.js'
import { fetchIpfsJson } from './_lib/ipfs.js'
import type { AgentResponse, ErrorResponse, FeedbackRecord, ValidationRequest, AgentMetadata } from './_lib/types.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

function json(res: VercelResponse, status: number, body: AgentResponse | ErrorResponse, cache = false) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
  if (cache) res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  res.status(status).json(body)
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'method_not_allowed', message: 'Only GET is supported' })
  }

  // ── Parameter validation ──────────────────────────────────────────────────
  const networkParam = (req.query.network as string | undefined)?.toLowerCase()
  const agentIdParam = req.query.agentId as string | undefined

  if (!networkParam || !agentIdParam) {
    return json(res, 400, {
      error:   'bad_request',
      message: "Required query parameters: network ('mainnet' | 'testnet') and agentId (positive integer)",
    })
  }
  if (networkParam !== 'mainnet' && networkParam !== 'testnet') {
    return json(res, 400, {
      error:   'bad_request',
      message: "network must be 'mainnet' or 'testnet'",
    })
  }
  if (!/^\d+$/.test(agentIdParam)) {
    return json(res, 400, {
      error:   'bad_request',
      message: 'agentId must be a positive integer',
    })
  }

  const networkKey = networkParam as 'mainnet' | 'testnet'
  const cfg = NETWORK_CONFIGS[networkKey]
  let agentIdBig: bigint
  try {
    agentIdBig = BigInt(agentIdParam)
    if (agentIdBig <= 0n) throw new Error()
  } catch {
    return json(res, 400, { error: 'bad_request', message: 'agentId must be a positive integer' })
  }
  const agentId = Number(agentIdBig)

  const client = getClient(networkKey)

  // ── Identity reads ────────────────────────────────────────────────────────
  let owner: string, agentWallet: string, metadataUri: string
  try {
    const [ownerResult, walletResult, uriResult] = await Promise.all([
      client.readContract({ address: cfg.identityRegistry, abi: identityAbi, functionName: 'ownerOf',       args: [agentIdBig] }),
      client.readContract({ address: cfg.identityRegistry, abi: identityAbi, functionName: 'getAgentWallet', args: [agentIdBig] }),
      client.readContract({ address: cfg.identityRegistry, abi: identityAbi, functionName: 'tokenURI',       args: [agentIdBig] }),
    ])
    owner       = ownerResult  as string
    agentWallet = walletResult as string
    metadataUri = uriResult    as string
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Check decoded viem error name first (requires ERC721NonexistentToken in ABI),
    // then fall back to message substrings for unexpected revert formats.
    const isNotFound =
      (err as { cause?: { data?: { errorName?: string } } })?.cause?.data?.errorName === 'ERC721NonexistentToken'
      || msg.includes('NonexistentToken')
      || msg.includes('invalid token')
      || msg.includes('does not exist')
      || msg.includes('ERC721')
    if (isNotFound) {
      return json(res, 404, {
        error:   'not_found',
        message: `Agent #${agentId} not found on ${cfg.label}`,
        agentId,
        network: networkKey,
        chainId: cfg.chainId,
      })
    }
    console.error('[api/agent] identity read failed:', msg)
    return json(res, 503, {
      error:   'rpc_error',
      message: `RPC call failed for ${cfg.label}: ${msg}`,
      agentId,
      network: networkKey,
      chainId: cfg.chainId,
    })
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
  let clientCount = 0
  let feedbackCount = 0
  let aggregateScore: string | null = null
  let clients: string[] = []
  const feedbackRecords: FeedbackRecord[] = []

  try {
    clients = (await client.readContract({
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
          tag1:          fbTag1s[i] || null,
          tag2:          fbTag2s[i] || null,
          isRevoked:     fbRevoked[i],
        })
      }
    }
  } catch (err) {
    // Reputation read failure is non-fatal — return what we have
    console.error('[api/agent] reputation read failed:', err instanceof Error ? err.message : err)
  }

  // ── Validation reads ──────────────────────────────────────────────────────
  const validationRequests: ValidationRequest[] = []
  let validationAvailable = false
  let validationReason: string | null = null
  let requestCount: number | null = null

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
      console.error('[api/agent] validation read failed:', err instanceof Error ? err.message : err)
      validationReason = 'Validation read failed'
    }
  }

  // ── Build response ────────────────────────────────────────────────────────
  const response: AgentResponse = {
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

  return json(res, 200, response, true)
}
