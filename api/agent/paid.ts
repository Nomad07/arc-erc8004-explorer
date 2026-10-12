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

// Supported payment networks — verified live against Circle Gateway GET /v1/x402/supported.
// All three networks are confirmed operational as of 2026-10-12.
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

// ── x402 v2 PaymentPayload shape (minimal typed subset) ───────────────────────
// Spec: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
// The network the buyer chose lives at `accepted.network`, NOT at the top level.
interface PaymentRequirements {
  scheme:            string
  network:           string
  asset:             string
  amount:            string
  payTo:             string
  maxTimeoutSeconds: number
  extra?:            Record<string, unknown>
}

interface PaymentPayload {
  x402Version: number
  resource?:   { url: string; description: string; mimeType: string }
  accepted:    PaymentRequirements   // ← network identifier lives here
  payload:     Record<string, unknown>
  extensions?: Record<string, unknown>
}

// ── CORS ──────────────────────────────────────────────────────────────────────
// PAYMENT-SIGNATURE: client sends signed payment payload (fix: was X-PAYMENT)
// PAYMENT-RESPONSE:  server returns settlement confirmation (fix: was missing)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, PAYMENT-SIGNATURE',
  'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE',
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
): PaymentRequirements {
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
function allPaymentRequirements(sellerAddress: string): PaymentRequirements[] {
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

/** Decode and structurally validate the x402 v2 PaymentPayload from the header value. */
function decodePaymentPayload(headerValue: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8')
    const raw = JSON.parse(decoded) as Record<string, unknown>
    // Structural guard: must have x402Version, accepted.network, and payload
    if (
      typeof raw !== 'object' || raw === null ||
      typeof raw.accepted !== 'object' || raw.accepted === null ||
      typeof (raw.accepted as Record<string, unknown>).network !== 'string' ||
      typeof raw.payload !== 'object' || raw.payload === null
    ) {
      return null
    }
    return raw as unknown as PaymentPayload
  } catch {
    return null
  }
}

/** Base64-encode a settle confirmation for the PAYMENT-RESPONSE header. */
function encodePaymentResponse(settleResult: { success: boolean; transaction: string; network: string; payer?: string }): string {
  return Buffer.from(JSON.stringify(settleResult)).toString('base64')
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
  // Check PAYMENT-SIGNATURE BEFORE query-parameter validation so that an unauthenticated
  // request to the bare URL returns 402 (with the full accepts[]) rather than 400.
  // The Circle readiness checker and agent buyers call the bare endpoint with no
  // query parameters — they need to see the 402 challenge first.
  //
  // x402 v2 header name: PAYMENT-SIGNATURE (not X-PAYMENT).
  // Vercel lower-cases incoming header names, so we read 'payment-signature'.
  const rawSignatureHeader = req.headers['payment-signature'] as string | undefined

  if (!rawSignatureHeader) {
    return require402(res, sellerAddress)
  }

  // ── Decode and structurally validate the payment payload ──────────────────
  // x402 v2 PaymentPayload: { x402Version, resource?, accepted: PaymentRequirements, payload, extensions? }
  // The buyer's chosen network is at paymentPayload.accepted.network (NOT top-level .network).
  const paymentPayload = decodePaymentPayload(rawSignatureHeader)
  if (!paymentPayload) {
    return require402(res, sellerAddress, {
      error:   'payment_invalid',
      message: 'PAYMENT-SIGNATURE could not be decoded. Expected base64-encoded x402 v2 PaymentPayload JSON with accepted.network and payload fields.',
    })
  }

  // ── Identify the payment network from paymentPayload.accepted.network ─────
  const paymentCaip2 = paymentPayload.accepted.network
  if (!SUPPORTED_CAIP2.has(paymentCaip2)) {
    return require402(res, sellerAddress, {
      error:   'payment_invalid',
      message: `Unsupported payment network: ${paymentCaip2}. Accepted: eip155:5042 (Arc Mainnet), eip155:8453 (Base Mainnet), or eip155:42161 (Arbitrum One).`,
    })
  }

  // ── Validate request parameters (only reached when PAYMENT-SIGNATURE is present) ──
  const networkParam = (req.query.network as string | undefined)?.toLowerCase()
  const agentIdParam = req.query.agentId as string | undefined

  if (!networkParam || !agentIdParam) {
    return json(res, 400, {
      error:   'bad_request',
      message: "Required query parameters: network ('mainnet') and agentId (positive integer)",
    })
  }

  // Paid endpoint resolves ERC-8004 data from Arc Mainnet only.
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

  // ── Build matching requirements and settle ────────────────────────────────
  // Match requirements to the exact network the buyer chose so the facilitator
  // can verify the EIP-3009 authorization against the correct chain + contract.
  const matchedNetwork = Object.values(PAYMENT_NETWORKS).find(n => n.caip2 === paymentCaip2)!
  const requirements = paymentRequirementsFor(matchedNetwork.caip2, matchedNetwork.usdc, sellerAddress)

  const facilitator = new BatchFacilitatorClient({ url: FACILITATOR_URL })

  let settleResult: { success: boolean; errorReason?: string; payer?: string; transaction: string; network: string }
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
      message: `Payment was rejected by the facilitator (${settleResult.errorReason ?? 'unknown reason'}). Ensure the payment is 0.01 USDC on a supported network.`,
    })
  }

  // ── Payment settled — resolve agent ──────────────────────────────────────
  // Data resolution happens AFTER confirmed settlement. A 404 or 503 here does
  // not indicate a failed payment — the payment settled successfully.
  let result: Awaited<ReturnType<typeof resolveAgent>>
  try {
    result = await resolveAgent('mainnet', agentId, agentIdBig)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[api/agent/paid] resolveAgent threw:', msg)
    // Payment already settled — return 200 with an error body rather than 402
    // to avoid misleading the caller into thinking they need to pay again.
    setCors(res)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('PAYMENT-RESPONSE', encodePaymentResponse({
      success:     true,
      transaction: settleResult.transaction,
      network:     settleResult.network,
      payer:       settleResult.payer,
    }))
    return res.status(200).json({
      error:   'internal_error',
      message: 'Payment settled but agent data could not be retrieved due to an unexpected error.',
      agentId,
      network: 'mainnet',
      paymentSettled: true,
    })
  }

  if (!result.ok) {
    const status = result.status satisfies 404 | 503
    // Payment already settled — return data-layer error at its natural status
    // but include paymentSettled so the caller is not billed twice.
    setCors(res)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('PAYMENT-RESPONSE', encodePaymentResponse({
      success:     true,
      transaction: settleResult.transaction,
      network:     settleResult.network,
      payer:       settleResult.payer,
    }))
    return res.status(status).json({
      error:        result.error,
      message:      result.message,
      agentId,
      network:      'mainnet',
      paymentSettled: true,
    })
  }

  // ── Success ───────────────────────────────────────────────────────────────
  // No public CDN cache on paid responses — each request must be individually paid.
  // PAYMENT-RESPONSE header: base64-encoded settlement confirmation per x402 v2 spec.
  setCors(res)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('PAYMENT-RESPONSE', encodePaymentResponse({
    success:     true,
    transaction: settleResult.transaction,
    network:     settleResult.network,
    payer:       settleResult.payer,
  }))
  return res.status(200).json(result.data)
}
