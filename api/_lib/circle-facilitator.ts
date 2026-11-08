/**
 * Thin client for Circle Facilitator Service (x402 v2), used by GET /api/agent/paid.
 *
 *   POST {FACILITATOR_BASE_URL}/verify
 *   POST {FACILITATOR_BASE_URL}/settle
 *   Authorization: Bearer <CIRCLE_FACILITATOR_API_KEY>
 *
 * Why not the SDK's HTTPFacilitatorClient / x402ResourceServer.settlePayment:
 *   - settlePayment() silently retries settle once on `settlement_pending`. This
 *     server must never retry an ambiguous settlement.
 *   - The SDK client collapses Circle's structured error bodies into plain
 *     strings, so the HTTP status and reason code would be lost.
 *
 * Every call is a single attempt with a timeout. Nothing here retries.
 *
 * Circle's documented semantics (developers.circle.com, Facilitator Service):
 *   - A settlement OUTCOME is always HTTP 200. 4xx/5xx mean the request was
 *     rejected or failed before an outcome.
 *   - `success: false` + `errorReason: settlement_pending` is unresolved and
 *     must not be fulfilled; a `settlement-status` extension carries `paymentId`.
 *   - Pre-recording validation failures return `success: false` with an
 *     `errorReason` and no extension.
 */

import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { FACILITATOR_BASE_URL } from './x402-config.js'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface FacilitatorClientOptions {
  apiKey:       string
  baseUrl?:     string
  fetchImpl?:   FetchLike
  verifyTimeoutMs?: number
  settleTimeoutMs?: number
}

export type VerifyOutcome =
  | { kind: 'valid'; payer?: string }
  | { kind: 'invalid'; reason: string }        // Circle says the payment is not valid
  | { kind: 'unavailable'; detail: string }    // no usable answer; nothing was moved

export type SettleOutcome =
  | { kind: 'settled'; transaction: string; network: string; payer?: string }
  | { kind: 'failed'; reason: string; httpStatus: number }                          // definite failure
  | { kind: 'ambiguous'; reason: string; httpStatus?: number; paymentId?: string }  // do not fulfil, do not retry

export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function firstErrorReason(body: unknown): string | undefined {
  if (!isRecord(body) || !Array.isArray(body.errors)) return undefined
  const first = body.errors[0]
  return isRecord(first) && typeof first.reason === 'string' ? first.reason : undefined
}

/** Safe, short reason code: letters, digits, underscore and dash only. */
function reasonCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : fallback
}

export function createCircleFacilitator(options: FacilitatorClientOptions) {
  const baseUrl = (options.baseUrl ?? FACILITATOR_BASE_URL).replace(/\/+$/, '')
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const verifyTimeoutMs = options.verifyTimeoutMs ?? 10_000
  const settleTimeoutMs = options.settleTimeoutMs ?? 45_000

  async function post(path: string, body: unknown, timeoutMs: number) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await res.text()
      let json: unknown
      try { json = JSON.parse(text) } catch { json = undefined }
      return { ok: true as const, status: res.status, json }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      return { ok: false as const, reason: aborted ? 'timeout' : 'network_error' }
    } finally {
      clearTimeout(timer)
    }
  }

  function requestBody(payload: PaymentPayload, requirements: PaymentRequirements) {
    return { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }
  }

  /** Verify moves no funds, so any failure here is safe and the payment is never settled. */
  async function verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyOutcome> {
    const res = await post('/verify', requestBody(payload, requirements), verifyTimeoutMs)
    if (!res.ok) return { kind: 'unavailable', detail: res.reason }

    if (res.status === 200 && isRecord(res.json) && typeof res.json.isValid === 'boolean') {
      if (res.json.isValid) {
        return { kind: 'valid', payer: typeof res.json.payer === 'string' ? res.json.payer : undefined }
      }
      return { kind: 'invalid', reason: reasonCode(res.json.invalidReason, 'verification_failed') }
    }
    // Our credentials, quota or Circle itself: not the buyer's fault.
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500 || res.status === 200) {
      return { kind: 'unavailable', detail: `http_${res.status}` }
    }
    if (res.status >= 400 && res.status < 500) {
      return { kind: 'invalid', reason: reasonCode(firstErrorReason(res.json), 'verification_rejected') }
    }
    return { kind: 'unavailable', detail: `http_${res.status}` }
  }

  /**
   * Settle exactly once. The caller delivers paid data ONLY for kind === 'settled'.
   * `expected.network` is the CAIP-2 id of the requirement that was matched.
   */
  async function settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    expected: { network: string; amount: string },
  ): Promise<SettleOutcome> {
    const res = await post('/settle', requestBody(payload, requirements), settleTimeoutMs)
    if (!res.ok) return { kind: 'ambiguous', reason: res.reason }

    if (res.status !== 200) {
      // Circle: 4xx/5xx mean the request failed before an outcome. 4xx is definite;
      // anything else (5xx, 3xx, 1xx) is treated as unknown.
      if (res.status >= 400 && res.status < 500 && isRecord(res.json)) {
        return {
          kind: 'failed',
          reason: reasonCode(firstErrorReason(res.json), `http_${res.status}`),
          httpStatus: res.status,
        }
      }
      return { kind: 'ambiguous', reason: `http_${res.status}`, httpStatus: res.status }
    }

    const body = res.json
    if (!isRecord(body) || typeof body.success !== 'boolean') {
      return { kind: 'ambiguous', reason: 'unexpected_body', httpStatus: 200 }
    }

    const statusExt = isRecord(body.extensions) && isRecord(body.extensions['settlement-status'])
      ? body.extensions['settlement-status']
      : undefined
    const paymentId = statusExt && typeof statusExt.paymentId === 'string' ? statusExt.paymentId : undefined

    if (body.success) {
      const tx = body.transaction
      if (typeof tx !== 'string' || !TX_HASH_RE.test(tx)) {
        return { kind: 'ambiguous', reason: 'success_without_transaction', httpStatus: 200, paymentId }
      }
      if (body.network !== expected.network) {
        return { kind: 'ambiguous', reason: 'network_mismatch', httpStatus: 200, paymentId }
      }
      if (body.amount !== undefined && body.amount !== expected.amount) {
        return { kind: 'ambiguous', reason: 'amount_mismatch', httpStatus: 200, paymentId }
      }
      return {
        kind: 'settled',
        transaction: tx,
        network: body.network,
        payer: typeof body.payer === 'string' ? body.payer : undefined,
      }
    }

    // success === false
    const reason = body.errorReason
    const pending = reason === 'settlement_pending'
    const recordedNotFailed = statusExt !== undefined && statusExt.status !== 'failed'
    if (pending || recordedNotFailed) {
      return { kind: 'ambiguous', reason: 'settlement_pending', httpStatus: 200, paymentId }
    }
    if (typeof reason === 'string' && reason.length > 0) {
      return { kind: 'failed', reason: reasonCode(reason, 'settlement_failed'), httpStatus: 200 }
    }
    return { kind: 'ambiguous', reason: 'unexpected_body', httpStatus: 200, paymentId }
  }

  return { verify, settle }
}

export type CircleFacilitator = ReturnType<typeof createCircleFacilitator>
