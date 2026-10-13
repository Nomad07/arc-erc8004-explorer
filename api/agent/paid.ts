/**
 * GET /api/agent/paid?network=mainnet&agentId=<uint>
 *
 * Paid ERC-8004 agent resolver — 0.01 USDC per successful request.
 * Payment: Circle Gateway Nanopayments, x402 Version 2.
 * Accepted payment networks: Arc Mainnet (eip155:5042), Base Mainnet (eip155:8453), Arbitrum One (eip155:42161).
 *
 * ERC-8004 data is ALWAYS resolved from Arc Mainnet regardless of which payment
 * network the caller uses. Base Mainnet is a payment network only — it has no
 * ERC-8004 registries and is never used as a data source.
 *
 * Strictly read-only with respect to ERC-8004 registries.
 * No private key. No custodial wallet. No write operations.
 * Circle Gateway facilitator handles all payment verification and settlement.
 *
 * arc-studio-allow-onchain-literal
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server'
import { resolveAgent } from '../_lib/resolve.js'
import type { ErrorResponse } from '../_lib/types.js'

// ── Payment constants ─────────────────────────────────────────────────────────
// arc-studio-allow-onchain-literal
const PAYMENT_AMOUNT        = '10000'                                        // 0.01 USDC (6 decimals)
const GATEWAY_CONTRACT      = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE'  // GatewayWallet on all EVM mainnets
const RESOURCE_URL          = 'https://www.arcagents.app/api/agent/paid'
const RESOURCE_DESCRIPTION  = 'Resolve an ERC-8004 agent identity on Arc. Returns identity, metadata, reputation, and validation data.'
const FACILITATOR_URL       = 'https://gateway-api.circle.com'

// Supported payment networks — verified live against Circle Gateway getSupported().
// ERC-8004 data always resolves from Arc Mainnet; these are payment-only networks.
// arc-studio-allow-onchain-literal
const PAYMENT_NETWORKS = {
  arc: {
    caip2:   'eip155:5042',
    usdc:    '0x3600000000000000000000000000000000000000', // Arc Mainnet USDC
  },
  base: {
    caip2:   'eip155:8453',
    usdc:    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base Mainnet USDC
  },
  arbitrum: {
    caip2:   'eip155:42161',
    usdc:    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum One USDC
  },
} as const

const SUPPORTED_CAIP2 = new Set(Object.values(PAYMENT_NETWORKS).map(n => n.caip2))

// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT',
  'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
}

function json(res: VercelResponse, status: number, body: unknown) {
  setCors(res)
  return res.status(status).json(body)
}

/** Build a single payment requirements object for the given payment network. */
function paymentRequirementsFor(
  caip2: string,
  usdcAddress: string,
  sellerAddress: string,
) {
  return {
    scheme:            'exact',
    network:           caip2,
    asset:             usdcAddress,
    amount:            PAYMENT_AMOUNT,
    payTo:             sellerAddress,
    maxTimeoutSeconds: 604900,
    extra: {
      name:              'GatewayWalletBatched',
      version:           '1',
      verifyingContract: GATEWAY_CONTRACT,
    },
  }
}

/** Build the full list of accepted payment requirements (one entry per supported network). */
function allPaymentRequirements(sellerAddress: string) {
  return [
    paymentRequirementsFor(PAYMENT_NETWORKS.arc.caip2,      PAYMENT_NETWORKS.arc.usdc,      sellerAddress),
    paymentRequirementsFor(PAYMENT_NETWORKS.base.caip2,     PAYMENT_NETWORKS.base.usdc,     sellerAddress),
    paymentRequirementsFor(PAYMENT_NETWORKS.arbitrum.caip2, PAYMENT_NETWORKS.arbitrum.usdc, sellerAddress),
  ]
}

function require402(res: VercelResponse, sellerAddress: string, errorBody?: ErrorResponse) {
  const paymentRequired = {
    x402Version: 2,
    resource: {
      url:         RESOURCE_URL,
      description: RESOURCE_DESCRIPTION,
      mimeType:    'application/json',
    },
    accepts: allPaymentRequirements(sellerAddress),
  }
  setCors(res)
  res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'))
  return res.status(402).json(errorBody ?? paymentRequired)
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Preflight
  if (req.method === 'OPTIONS') {
    setCors(res)
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'method_not_allowed', message: 'Only GET is supported' })
  }

  // ── Validate SELLER_ADDRESS ───────────────────────────────────────────────
  const sellerAddress = process.env.SELLER_ADDRESS
  if (!sellerAddress || !/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
    console.error('[api/agent/paid] SELLER_ADDRESS missing or invalid')
    return json(res, 500, { error: 'server_misconfigured', message: 'Payment service is not configured.' })
  }

  // ── Payment gate ──────────────────────────────────────────────────────────
  // Check X-PAYMENT BEFORE query-parameter validation so that an unauthenticated
  // request to the bare URL returns 402 (with the full accepts[]) rather than 400.
  // The Circle readiness checker and agent buyers call the bare endpoint with no
  // query parameters — they need to see the 402 challenge first.
  const xPayment = req.headers['payment-signature'] as string | undefined

  if (!xPayment) {
    // No payment header — return 402 with requirements for all supported payment networks
    return require402(res, sellerAddress)
  }

  // ── Validate request parameters (only reached when X-PAYMENT is present) ──
  const networkParam = (req.query.network as string | undefined)?.toLowerCase()
  const agentIdParam = req.query.agentId as string | undefined

  if (!networkParam || !agentIdParam) {
    return json(res, 400, {
      error:   'bad_request',
      message: "Required query parameters: network ('mainnet') and agentId (positive integer)",
    })
  }

  // Paid endpoint resolves ERC-8004 data from Arc Mainnet only.
  // 'testnet' and any non-mainnet ERC-8004 network are not supported.
  if (networkParam === 'testnet') {
    return json(res, 400, {
      error:   'bad_request',
      message: 'The paid endpoint only supports Arc Mainnet ERC-8004 data (network=mainnet). Testnet lookups are not available on the paid endpoint.',
    })
  }

  if (networkParam !== 'mainnet') {
    return json(res, 400, {
      error:   'bad_request',
      message: "network must be 'mainnet' for the paid endpoint (ERC-8004 data network is Arc Mainnet)",
    })
  }

  if (!/^\d+$/.test(agentIdParam)) {
    return json(res, 400, { error: 'bad_request', message: 'agentId must be a positive integer' })
  }

  let agentIdBig: bigint
  try {
    agentIdBig = BigInt(agentIdParam)
    if (agentIdBig <= 0n) throw new Error()
  } catch {
    return json(res, 400, { error: 'bad_request', message: 'agentId must be a positive integer' })
  }
  const agentId = Number(agentIdBig)

  // Parse payment payload and determine which payment network the caller used
  let paymentPayload: Record<string, unknown>
  try {
    const decoded = Buffer.from(xPayment, 'base64').toString('utf8')
    paymentPayload = JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return require402(res, sellerAddress, {
      error:   'payment_invalid',
      message: 'X-PAYMENT header could not be decoded. Expected base64-encoded JSON.',
    })
  }

  // Identify the payment network from the payload so we can settle against
  // the matching requirements. The x402 payload carries the network as a
  // CAIP-2 string at the top level.
  const paymentCaip2 = (paymentPayload.network ?? paymentPayload.x402Network) as string | undefined
  if (!paymentCaip2 || !SUPPORTED_CAIP2.has(paymentCaip2)) {
    return require402(res, sellerAddress, {
      error:   'payment_invalid',
      message: `Unsupported payment network: ${String(paymentCaip2 ?? 'unknown')}. Accepted: eip155:5042 (Arc Mainnet), eip155:8453 (Base Mainnet), or eip155:42161 (Arbitrum One).`,
    })
  }

  // Build the matching requirements for this specific payment network
  const matchedNetwork = Object.values(PAYMENT_NETWORKS).find(n => n.caip2 === paymentCaip2)!
  const requirements = paymentRequirementsFor(matchedNetwork.caip2, matchedNetwork.usdc, sellerAddress)

  const facilitator = new BatchFacilitatorClient({ url: FACILITATOR_URL })

  let settleResult: { success: boolean; errorReason?: string }
  try {
    settleResult = await facilitator.settle(
      paymentPayload as Parameters<typeof facilitator.settle>[0],
      requirements  as Parameters<typeof facilitator.settle>[1],
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[api/agent/paid] facilitator.settle() threw:', msg)
    return require402(res, sellerAddress, {
      error:   'payment_failed',
      message: 'Payment settlement failed. Please retry with a valid payment.',
    })
  }

  if (!settleResult.success) {
    console.error('[api/agent/paid] settlement rejected:', settleResult.errorReason)
    return require402(res, sellerAddress, {
      error:   'payment_failed',
      message: 'Payment was rejected by the facilitator. Ensure the payment is 0.01 USDC on Arc Mainnet (eip155:5042), Base Mainnet (eip155:8453), or Arbitrum One (eip155:42161).',
    })
  }

  // ── Payment settled — resolve agent ──────────────────────────────────────
  let result: Awaited<ReturnType<typeof resolveAgent>>
  try {
    result = await resolveAgent('mainnet', agentId, agentIdBig)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[api/agent/paid] resolveAgent threw:', msg)
    return json(res, 500, { error: 'internal_error', message: 'Unexpected server error.' })
  }

  if (!result.ok) {
    const status = result.status satisfies 404 | 503
    return json(res, status, {
      error:   result.error,
      message: result.message,
      agentId,
      network: 'mainnet',
    })
  }

  // No public CDN cache on paid responses — each request must be individually paid
  setCors(res)
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json(result.data)
}
