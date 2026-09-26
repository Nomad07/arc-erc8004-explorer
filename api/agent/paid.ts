/**
 * GET /api/agent/paid?network=mainnet&agentId=<uint>
 *
 * Paid ERC-8004 agent resolver — 0.01 USDC per successful request.
 * Payment: Circle Gateway Nanopayments, x402 Version 2, Arc Mainnet (eip155:5042).
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

// ── Payment constants (Arc Mainnet, USDC, 0.01 USDC = 10000 units) ───────────
// arc-studio-allow-onchain-literal
const PAYMENT_NETWORK       = 'eip155:5042'
const USDC_ADDRESS          = '0x3600000000000000000000000000000000000000' // Arc Mainnet USDC
const PAYMENT_AMOUNT        = '10000'                                       // 0.01 USDC (6 decimals)
const GATEWAY_CONTRACT      = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' // GatewayWallet on all EVM mainnets
const RESOURCE_URL          = 'https://www.arcagents.app/api/agent/paid'
const RESOURCE_DESCRIPTION  = 'Resolve an ERC-8004 agent identity on Arc. Returns identity, metadata, reputation, and validation data.'
const FACILITATOR_URL       = 'https://gateway-api.circle.com'

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

function paymentRequirements(sellerAddress: string) {
  return {
    scheme:            'exact',
    network:           PAYMENT_NETWORK,
    asset:             USDC_ADDRESS,
    amount:            PAYMENT_AMOUNT,
    payTo:             sellerAddress,
    maxTimeoutSeconds: 604900,
    extra: {
      name:               'GatewayWalletBatched',
      version:            '1',
      verifyingContract:  GATEWAY_CONTRACT,
    },
  }
}

function require402(res: VercelResponse, sellerAddress: string, errorBody?: ErrorResponse) {
  const paymentRequired = {
    x402Version: 2,
    resource: {
      url:         RESOURCE_URL,
      description: RESOURCE_DESCRIPTION,
      mimeType:    'application/json',
    },
    accepts: [paymentRequirements(sellerAddress)],
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

  // ── Validate request parameters BEFORE accepting payment ─────────────────
  const networkParam = (req.query.network as string | undefined)?.toLowerCase()
  const agentIdParam = req.query.agentId as string | undefined

  if (!networkParam || !agentIdParam) {
    return json(res, 400, {
      error:   'bad_request',
      message: "Required query parameters: network ('mainnet') and agentId (positive integer)",
    })
  }

  // Paid endpoint is Mainnet-only
  if (networkParam === 'testnet') {
    return json(res, 400, {
      error:   'bad_request',
      message: 'The paid endpoint only supports Arc Mainnet (network=mainnet). Use /api/agent for free Testnet lookups.',
    })
  }

  if (networkParam !== 'mainnet') {
    return json(res, 400, {
      error:   'bad_request',
      message: "network must be 'mainnet' for the paid endpoint",
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

  // ── Payment gate ──────────────────────────────────────────────────────────
  const xPayment = req.headers['x-payment'] as string | undefined

  if (!xPayment) {
    // No payment header — return 402 with requirements
    return require402(res, sellerAddress)
  }

  // Parse and settle payment via Circle Gateway facilitator
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

  const facilitator = new BatchFacilitatorClient({ url: FACILITATOR_URL })
  const requirements = paymentRequirements(sellerAddress)

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
      message: 'Payment was rejected by the facilitator. Ensure the payment is for Arc Mainnet USDC (0.01 USDC).',
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
