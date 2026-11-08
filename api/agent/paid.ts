/**
 * GET /api/agent/paid?network=mainnet&agentId=<uint>
 *
 * Paid ERC-8004 agent resolver. 0.002 USDC per successful request.
 * Payment: x402 v2 `exact` (EIP-3009), verified and settled by Circle Facilitator Service.
 * Payment networks: Arc Mainnet (eip155:5042) and Base Mainnet (eip155:8453).
 *
 * ERC-8004 data is ALWAYS resolved from Arc Mainnet regardless of which payment
 * network the caller uses. Base Mainnet is a payment network only.
 *
 * Flow: 402 challenge -> validate query -> match payment to a requirement ->
 * Circle verify -> resolve agent -> Circle settle (exactly once) -> respond.
 * Paid data is returned only when Circle confirms settlement with a valid
 * transaction hash on the expected network. An ambiguous settlement is never
 * retried and never fulfilled.
 *
 * No private key, no custodial wallet, no Gateway deposit. USDC is paid
 * directly to the external SELLER_ADDRESS. This server keeps no payment state
 * and adds no replay protection of its own; see docs/x402-audit-report.md.
 *
 * arc-studio-allow-onchain-literal
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { x402ResourceServer } from '@x402/core/server'
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http'
import type { Network, PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types'
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar'
import { resolveAgent } from '../_lib/resolve.js'
import type { ErrorResponse } from '../_lib/types.js'
import { createCircleFacilitator, type CircleFacilitator } from '../_lib/circle-facilitator.js'
import {
  AGENT_RESPONSE_SCHEMA,
  DISCOVERY_INPUT_EXAMPLE,
  DISCOVERY_INPUT_SCHEMA,
  DISCOVERY_OUTPUT_EXAMPLE,
  MAX_TIMEOUT_SECONDS,
  PAYMENT_NETWORKS,
  PRICE_ATOMIC,
  RESOURCE_URL,
  SERVICE_DESCRIPTION,
  SERVICE_ICON_URL,
  SERVICE_NAME,
  SERVICE_TAGS,
} from '../_lib/x402-config.js'

// ── CORS ──────────────────────────────────────────────────────────────────────
// PAYMENT-SIGNATURE is the x402 v2 request header; PAYMENT-REQUIRED / PAYMENT-RESPONSE
// are the v2 response headers and must be exposed to browser clients.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':   '*',
  'Access-Control-Allow-Methods':  'GET, OPTIONS',
  'Access-Control-Allow-Headers':  'Content-Type, PAYMENT-SIGNATURE',
  'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE',
}

function setCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
}

function json(res: VercelResponse, status: number, body: unknown) {
  setCors(res)
  return res.status(status).json(body)
}

// ── x402 server pieces (no network access needed to build the challenge) ──────
const x402Server = new x402ResourceServer().registerExtension(bazaarResourceServerExtension)

// Official Bazaar declaration, built from the real endpoint. The HTTP method (GET)
// is added by bazaarResourceServerExtension when the declaration is enriched.
const BAZAAR_DECLARATION = declareDiscoveryExtension({
  input:       DISCOVERY_INPUT_EXAMPLE,
  inputSchema: DISCOVERY_INPUT_SCHEMA as unknown as Record<string, unknown>,
  output: {
    example: DISCOVERY_OUTPUT_EXAMPLE,
    schema:  AGENT_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
  },
})

const HTTP_CONTEXT = {
  method: 'GET',
  path:   '/api/agent/paid',
  adapter: {
    getHeader:       () => undefined,
    getMethod:       () => 'GET',
    getPath:         () => '/api/agent/paid',
    getUrl:          () => RESOURCE_URL,
    getAcceptHeader: () => 'application/json',
    getUserAgent:    () => '',
  },
}

/** One requirement per supported network; the EIP-712 domain differs per network. */
export function buildPaymentRequirements(sellerAddress: string): PaymentRequirements[] {
  return PAYMENT_NETWORKS.map(n => ({
    scheme:            'exact',
    network:           n.caip2 as Network,
    asset:             n.asset,
    amount:            PRICE_ATOMIC,
    payTo:             sellerAddress,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra:             { name: n.domainName, version: n.domainVersion },
  }))
}

export async function buildPaymentRequired(sellerAddress: string, error?: string): Promise<PaymentRequired> {
  const extensions = x402Server.enrichExtensions(BAZAAR_DECLARATION, HTTP_CONTEXT)
  return x402Server.createPaymentRequiredResponse(
    buildPaymentRequirements(sellerAddress),
    {
      url:         RESOURCE_URL,
      description: SERVICE_DESCRIPTION,
      mimeType:    'application/json',
      serviceName: SERVICE_NAME,
      tags:        SERVICE_TAGS,
      iconUrl:     SERVICE_ICON_URL,
    },
    error,
    extensions,
    HTTP_CONTEXT,
  )
}

async function require402(res: VercelResponse, sellerAddress: string, errorBody?: ErrorResponse) {
  const paymentRequired = await buildPaymentRequired(sellerAddress, errorBody?.error)
  setCors(res)
  res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(paymentRequired))
  return res.status(402).json(errorBody ?? paymentRequired)
}

function readAuthorization(payload: PaymentPayload): { payer?: string; nonce?: string } {
  const inner = payload.payload as { authorization?: { from?: unknown; nonce?: unknown } } | undefined
  const a = inner?.authorization
  return {
    payer: typeof a?.from === 'string' ? a.from : undefined,
    nonce: typeof a?.nonce === 'string' ? a.nonce : undefined,
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export interface PaidHandlerDeps {
  resolveAgent:        typeof resolveAgent
  createFacilitator:   (apiKey: string) => CircleFacilitator
  env:                 () => Record<string, string | undefined>
}

const defaultDeps: PaidHandlerDeps = {
  resolveAgent,
  createFacilitator: apiKey => createCircleFacilitator({ apiKey }),
  env: () => process.env,
}

export function createPaidHandler(deps: PaidHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    // Preflight
    if (req.method === 'OPTIONS') {
      setCors(res)
      return res.status(204).end()
    }

    if (req.method !== 'GET') {
      return json(res, 405, { error: 'method_not_allowed', message: 'Only GET is supported' })
    }

    // ── Configuration (secrets are read here, never logged) ───────────────────
    const env = deps.env()
    const sellerAddress = env.SELLER_ADDRESS
    const apiKey        = env.CIRCLE_FACILITATOR_API_KEY
    if (!sellerAddress || !/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
      console.error('[api/agent/paid] SELLER_ADDRESS missing or invalid')
      return json(res, 500, { error: 'server_misconfigured', message: 'Payment service is not configured.' })
    }
    if (!apiKey) {
      console.error('[api/agent/paid] CIRCLE_FACILITATOR_API_KEY missing')
      return json(res, 500, { error: 'server_misconfigured', message: 'Payment service is not configured.' })
    }

    // ── Payment gate ──────────────────────────────────────────────────────────
    // Check PAYMENT-SIGNATURE BEFORE query-parameter validation so that an unauthenticated
    // request to the bare URL returns 402 (with the full accepts[]) rather than 400.
    // Scanners and agent buyers call the bare endpoint first and need the challenge.
    const paymentHeader = req.headers['payment-signature'] as string | undefined
    if (!paymentHeader) {
      return require402(res, sellerAddress)
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

    // ── Decode the payment and match it to one of our requirements ────────────
    let payload: PaymentPayload
    try {
      payload = decodePaymentSignatureHeader(paymentHeader)
    } catch {
      return require402(res, sellerAddress, {
        error:   'payment_invalid',
        message: 'PAYMENT-SIGNATURE could not be decoded. Expected a base64-encoded x402 v2 payment payload.',
      })
    }
    if (payload?.x402Version !== 2) {
      return require402(res, sellerAddress, {
        error:   'payment_invalid',
        message: 'Unsupported x402 version. This endpoint requires x402 v2.',
      })
    }

    const requirementsList = buildPaymentRequirements(sellerAddress)
    const matched = x402Server.findMatchingRequirements(requirementsList, payload)
    if (!matched) {
      const offered = typeof payload.accepted?.network === 'string' ? payload.accepted.network.slice(0, 40) : 'unknown'
      return require402(res, sellerAddress, {
        error:   'payment_invalid',
        message: `Payment does not match an accepted option (network: ${offered}). Accepted: eip155:5042 (Arc Mainnet) or eip155:8453 (Base Mainnet), exact scheme, 2000 atomic USDC units (0.002 USDC).`,
      })
    }

    const paymentRequired = await buildPaymentRequired(sellerAddress)
    const echo = x402Server.validateExtensions(paymentRequired, payload)
    if (!echo.valid) {
      return require402(res, sellerAddress, {
        error:   'payment_invalid',
        message: 'Payment extensions do not match the advertised discovery metadata.',
      })
    }

    const facilitator = deps.createFacilitator(apiKey)

    // ── Verify (moves no funds) ───────────────────────────────────────────────
    const verified = await facilitator.verify(payload, matched)
    if (verified.kind === 'unavailable') {
      console.error('[api/agent/paid] verify unavailable:', verified.detail)
      return json(res, 503, {
        error:   'payment_service_unavailable',
        message: 'The payment service could not verify the payment. You were not charged. Please retry.',
      })
    }
    if (verified.kind === 'invalid') {
      return require402(res, sellerAddress, {
        error:   'payment_invalid',
        message: `Payment was rejected by the facilitator (${verified.reason}). Pay 0.002 USDC on Arc Mainnet or Base Mainnet.`,
      })
    }

    // ── Resolve the agent BEFORE settling: a 404/503 is never charged ─────────
    let result: Awaited<ReturnType<typeof resolveAgent>>
    try {
      result = await deps.resolveAgent('mainnet', agentId, agentIdBig)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[api/agent/paid] resolveAgent threw:', msg)
      return json(res, 500, { error: 'internal_error', message: 'Unexpected server error. You were not charged.' })
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

    // ── Settle exactly once. Never retried. ───────────────────────────────────
    const settled = await facilitator.settle(payload, matched, { network: matched.network, amount: matched.amount })

    if (settled.kind === 'failed') {
      console.error('[api/agent/paid] settlement failed:', settled.reason, settled.httpStatus)
      return require402(res, sellerAddress, {
        error:   'payment_failed',
        message: `Payment could not be settled (${settled.reason}). Sign a new payment of 0.002 USDC on Arc Mainnet or Base Mainnet.`,
      })
    }

    if (settled.kind === 'ambiguous') {
      const { payer, nonce } = readAuthorization(payload)
      // No signature, API key or other secret is logged.
      console.error('[api/agent/paid] settlement AMBIGUOUS, not retried:', JSON.stringify({
        network: matched.network, reason: settled.reason, httpStatus: settled.httpStatus,
        paymentId: settled.paymentId, payer, nonce, at: new Date().toISOString(),
      }))
      return json(res, 503, {
        error:   'payment_pending',
        message: 'The payment settlement is not confirmed yet. No data was returned. Do not pay again until the payment status is checked.',
      })
    }

    // Circle confirmed settlement with a valid transaction hash on the expected network.
    setCors(res)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('PAYMENT-RESPONSE', encodePaymentResponseHeader({
      success:     true,
      transaction: settled.transaction,
      network:     settled.network as Network,
      payer:       settled.payer,
    }))
    return res.status(200).json(result.data)
  }
}

export default createPaidHandler(defaultDeps)
