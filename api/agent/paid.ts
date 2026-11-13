/**
 * GET /api/agent/paid?network=mainnet&agentId=<uint>
 *
 * Paid ERC-8004 agent resolver. 0.002 USDC per successful request.
 * Payment: x402 v2 `exact` (EIP-3009) on Arc Mainnet (eip155:5042) or Base Mainnet (eip155:8453), verified and
 * settled by the Ultravioleta DAO facilitator (https://facilitator.ultravioletadao.xyz, no API key) through the
 * official SDK (`uvd-x402-sdk` 2.114.0): `FacilitatorClient.verify()` / `.settle()`.
 * ERC-8004 data is ALWAYS resolved from Arc Mainnet; Base is a payment network only.
 *
 * Flow: 402 challenge -> validate query -> match payment to a requirement -> verify -> resolve agent ->
 * settle -> respond. A missing agent is therefore never charged.
 *
 * What this file owns: request validation, the 402 challenge and Bazaar metadata, the agent lookup, a time guard,
 * and releasing data only after a CONFIRMED settlement. What Ultravioleta (through the SDK) owns: payment
 * verification, settlement, idempotency, replay protection, its safe retries, and every error classification.
 * Answers use the SDK's own response helpers; a settlement problem is never a new 402 challenge.
 *
 * arc-studio-allow-onchain-literal
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { x402ResourceServer } from '@x402/core/server'
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from '@x402/core/http'
import type { Network, PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types'
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar'
import {
  AUTHORIZATION_ALREADY_SETTLED,
  AUTHORIZATION_IN_FLIGHT,
  DEFAULT_RETRY_AFTER_SECONDS,
  buildPaymentConflictResponse,
  buildUnavailableResponse,
  createIdempotencyKey,
  mergePaymentResponseHeaders,
  validatePurchaseContext,
} from 'uvd-x402-sdk/backend'
import { resolveAgent } from '../_lib/resolve.js'
import {
  SETTLE_START_DEADLINE_MS,
  createPaymentFacilitator,
  toSdkPayment,
  toSdkRequirements,
  type PaymentFacilitator,
  type SdkSettleResult,
} from '../_lib/x402-facilitator.js'
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

/** A JSON error body with at least an `error` string (our own 4xx, or the SDK's verification refusal). */
type ErrorBody = { error: string; message?: string; [key: string]: unknown }

// ── CORS ──────────────────────────────────────────────────────────────────────
// PAYMENT-SIGNATURE is the x402 v2 request header; PAYMENT-REQUIRED / PAYMENT-RESPONSE
// are the v2 response headers and must be exposed to browser clients.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':   '*',
  'Access-Control-Allow-Methods':  'GET, OPTIONS',
  'Access-Control-Allow-Headers':  'Content-Type, PAYMENT-SIGNATURE, X-UVD-Purchase',
  'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, Retry-After',
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

async function require402(res: VercelResponse, sellerAddress: string, errorBody?: ErrorBody) {
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

/** Send an SDK `{ status, headers, body }` answer (buildPaymentConflictResponse / buildUnavailableResponse). */
function sendSdkResponse(res: VercelResponse, answer: { status: number; headers: Record<string, string>; body: unknown }) {
  setCors(res)
  res.setHeader('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(answer.headers)) res.setHeader(name, value)
  return res.status(answer.status).json(answer.body)
}

/**
 * PAYMENT-RESPONSE / X-PAYMENT-RESPONSE through the SDK's own helper (it also merges our CORS expose list and sets
 * no-store). If the SDK result is too large for the header (the helper throws), `fallback` carries just the established
 * fields so a paid response is never lost.
 */
function paymentResponseHeadersFor(res: VercelResponse, body: Record<string, unknown>, fallback?: Record<string, unknown>): Record<string, string> {
  setCors(res)
  const current = (name: string) => {
    const value = res.getHeader(name)
    return value === undefined ? undefined : String(value)
  }
  try {
    return mergePaymentResponseHeaders(body, current)
  } catch (err) {
    if (!fallback) throw err
    return mergePaymentResponseHeaders(fallback, current)
  }
}

/**
 * A line-for-line mirror of the SDK's `refuseUnboundReplay` (uvd-x402-sdk 2.114.0, dist/backend/index.mjs ~3259), which
 * it applies in its middleware to every request that has no purchase context but does not export. A replayed answer
 * reached without a purchase context is somebody else's purchase: a replayed success becomes "already settled", a
 * replayed pending result becomes "in flight", and the transaction details are withheld in both.
 */
function refuseUnboundReplay(result: SdkSettleResult): SdkSettleResult {
  if (!result.replayed) return result
  const pending = result.receipt?.status === 'pending' || result.receipt?.status === 'unknown' || result.errorCode === 'settlement_in_progress'
  if (!result.success && !pending) return result
  const { transactionHash: _tx, proofOfPayment: _proof, paymentId: _id, transaction: _t, retryAfterSeconds, ...rest } = result
  if (result.success) {
    return { ...rest, success: false, error: AUTHORIZATION_ALREADY_SETTLED, errorCode: AUTHORIZATION_ALREADY_SETTLED, retryable: false, safeToReplay: false }
  }
  return {
    ...rest, success: false, error: AUTHORIZATION_IN_FLIGHT, errorCode: AUTHORIZATION_IN_FLIGHT,
    retryable: true, safeToReplay: false, retryAfterSeconds: retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS,
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export interface PaidHandlerDeps {
  resolveAgent: typeof resolveAgent
  facilitator:  PaymentFacilitator
  env:          () => Record<string, string | undefined>
  /** Test seam for the time guard. */
  now?:         () => number
}

const defaultDeps: PaidHandlerDeps = {
  resolveAgent,
  facilitator: createPaymentFacilitator(),
  env: () => process.env,
}

export function createPaidHandler(deps: PaidHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const now = deps.now ?? Date.now
    const startedAt = now()
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
    if (!sellerAddress || !/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
      console.error('[api/agent/paid] SELLER_ADDRESS missing or invalid')
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
    // A repeated parameter (?network=a&network=b) arrives as an array: refuse it cleanly (400) instead of throwing.
    if (Array.isArray(req.query.network) || Array.isArray(req.query.agentId)) {
      return json(res, 400, { error: 'bad_request', message: 'Query parameters must not be repeated.' })
    }
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

    // ── Purchase context (X-UVD-Purchase) and the payment's single Idempotency-Key ──
    // The buyer's capability must describe THIS request: method, full public URL (so network and agentId) and an
    // empty body. The SDK checks it; a context for another agent or network is refused before any facilitator call.
    // The same URL is the payment resource sent to the facilitator, as the SDK's own paywall does.
    const actualUrl = new URL(req.url ?? '', RESOURCE_URL).toString()
    let receiptContext: string | undefined
    try {
      const header = req.headers['x-uvd-purchase']
      if (Array.isArray(header)) throw new Error('invalid purchase context')
      receiptContext = validatePurchaseContext(header, 'GET', actualUrl, new Uint8Array())
    } catch {
      return json(res, 400, { error: 'receipt_context_mismatch' })
    }
    // One key for this payment's verify and settle (and for the SDK's own retries of them).
    const binding = { idempotencyKey: createIdempotencyKey(), ...(receiptContext ? { receiptContext } : {}) }
    const sdkPayment = toSdkPayment(payload, matched)
    const sdkRequirements = toSdkRequirements(matched, actualUrl)

    // ── Verify (moves no funds) ───────────────────────────────────────────────
    const verified = await deps.facilitator.verify(sdkPayment, sdkRequirements, binding)
    if (!verified.isValid) {
      // Facts only (status, code, reason text from the facilitator): no header, payload or signature.
      console.error('[api/agent/paid] verify not valid:', JSON.stringify({ status: verified.status, errorCode: verified.errorCode, retryable: verified.retryable, reason: verified.invalidReason }))
      // An authorization already used / in flight, or admitted for another request: 409 / 503, never a new payment.
      const conflict = buildPaymentConflictResponse(verified)
      if (conflict) return sendSdkResponse(res, conflict)
      // No verdict (the facilitator never looked at the payment): 503 + Retry-After, never a rejection.
      if (verified.retryable) return sendSdkResponse(res, buildUnavailableResponse('Payment verification unavailable', verified))
      // A real rejection: the buyer needs the challenge again.
      return require402(res, sellerAddress, { error: 'Payment verification failed', reason: verified.invalidReason })
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

    // ── Settle only if it can still finish inside the function limit (see x402-facilitator.ts) ──
    if (now() - startedAt > SETTLE_START_DEADLINE_MS) {
      console.error('[api/agent/paid] time budget exhausted before settlement; nothing was settled')
      return sendSdkResponse(res, buildUnavailableResponse('Payment settlement not started: the request ran out of time. You were not charged', {
        reason: 'time_budget_exhausted', retryAfterSeconds: 5, safeToReplay: true,
      }))
    }
    const answered = await deps.facilitator.settle(sdkPayment, sdkRequirements, binding)
    // Exactly as the SDK middleware does (`binding.receiptContext ? answer : refuseUnboundReplay(answer)`): the
    // FacilitatorClient only applies this itself when no key is passed, and we always pass one.
    const settled = receiptContext ? answered : refuseUnboundReplay(answered)

    // Confirmed = the facilitator says success, there is a transaction hash, the SDK does not flag it as pending or
    // unknown (`retryable`), and an attached receipt says `confirmed` (the docs: `verified`/`pending`/`unknown`/
    // `rejected` are not a completed payment). Anything else releases no data.
    const confirmed = settled.success && !!settled.transactionHash && settled.retryable !== true &&
      (settled.receipt === undefined || settled.receipt === null || settled.receipt.status === 'confirmed')
    if (!confirmed) {
      const { payer, nonce } = readAuthorization(payload)
      console.error('[api/agent/paid] settlement not confirmed, nothing released:', JSON.stringify({
        network: matched.network, reason: settled.error ?? settled.errorReason, errorCode: settled.errorCode, status: settled.status,
        retryable: settled.retryable, transaction: settled.transaction ?? settled.transactionHash, paymentId: settled.paymentId,
        payer, nonce, at: new Date().toISOString(),
      }))
      const conflict = buildPaymentConflictResponse(settled)
      if (conflict) return sendSdkResponse(res, conflict)
      // The SDK middleware's own rule: `retryable` (it sets that for a pending or unknown receipt) -> 503 + Retry-After.
      if (settled.retryable) return sendSdkResponse(res, buildUnavailableResponse('Payment settlement unavailable', settled))
      // Failed for good or cannot be confirmed (the SDK middleware's 500): the transaction, if any, is in the body.
      // A failure receipt goes out ONLY for a verdict the facilitator itself stated (a 2xx answer with success:false and
      // an errorReason, no pending/unconfirmed marker): an ambiguous or unconfirmed result carries no PAYMENT-RESPONSE.
      const stated = !settled.success && settled.errorReason !== undefined && settled.errorCode === undefined   // (a retryable result already returned above)
      return sendSdkResponse(res, {
        status: 500,
        headers: stated
          ? paymentResponseHeadersFor(res, {
              success: false, errorReason: settled.errorReason, ...(settled.error ? { errorMessage: settled.error } : {}),
              payer: settled.payer ?? readAuthorization(payload).payer, transaction: settled.transactionHash ?? '', network: matched.network,
            })
          : {},
        body: {
          error:     'Payment settlement failed',
          reason:    settled.error || settled.errorReason || (settled.success ? (settled.transactionHash ? 'receipt_not_confirmed' : 'missing_transaction_hash') : 'Unknown error'),
          retryable: false,
          ...(settled.errorCode !== undefined ? { errorCode: settled.errorCode } : {}),
          ...((settled.transaction ?? settled.transactionHash) !== undefined ? { transaction: settled.transaction ?? settled.transactionHash } : {}),
          ...(settled.paymentId !== undefined ? { paymentId: settled.paymentId } : {}),
        },
      })
    }

    // ── Confirmed: PAYMENT-RESPONSE through the SDK helper, with the established fields ──
    // Contract kept from the NFT Data x402 API: success, payer, transaction, network. The SDK's own result fields
    // (transactionHash, receipt, paymentId) ride along; the merchant-private idempotency key does not.
    const { idempotencyKey: _private, ...propagated } = settled
    const settlementResponse = {
      ...propagated,
      success:     true,
      payer:       settled.payer ?? readAuthorization(payload).payer,
      transaction: settled.transactionHash,
      network:     matched.network,
    }
    setCors(res)
    const headers = paymentResponseHeadersFor(res, settlementResponse, {
      success: true, payer: settlementResponse.payer, transaction: settled.transactionHash, network: matched.network,
    })
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
    return res.status(200).json(result.data)
  }
}

export default createPaidHandler(defaultDeps)
