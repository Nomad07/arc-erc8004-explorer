/**
 * Ultravioleta DAO facilitator access for GET /api/agent/paid.
 *
 * Everything payment-related is done by the OFFICIAL SDK (`uvd-x402-sdk` 2.114.0, `uvd-x402-sdk/backend`):
 *   - `FacilitatorClient.verify()` / `.settle()`  HTTP, v2 envelope, Idempotency-Key + X-UVD-Purchase headers,
 *                                                 timeouts, the SDK's own replay-safe retries, error parsing,
 *                                                 transaction-hash reading, receipt parsing
 *   - `validatePurchaseContext()`, `createIdempotencyKey()`
 *   - `buildPaymentConflictResponse()`, `buildUnavailableResponse()`, `mergePaymentResponseHeaders()`
 * This file only (a) fixes the timeout / retry settings that keep the function inside Vercel's limit and
 * (b) adapts our @x402/core objects to the SDK's request types. No protocol logic lives here.
 *
 * Timeout and retry settings (the only knobs the SDK offers: `timeout` per attempt, `retries` extra attempts)
 * -------------------------------------------------------------------------------------------------------
 * `FacilitatorClient` never retries a timeout; it retries ONLY a refusal the facilitator proved it did not execute
 * (429, or 503 with a pre-execution reason), and sleeps that refusal's `Retry-After`, clamped by the SDK to
 * MAX_RETRY_AFTER_SECONDS (15 s). Each attempt is aborted after `timeout`. So the worst case of one call is
 *
 *     worst(timeout, retries) = (retries + 1) * timeout + retries * MAX_RETRY_AFTER
 *
 * `timeout` MUST be set explicitly: left unset, the SDK gives Base (chain 8453) a 90 s settle timeout
 * (ESCROW_TIMEOUT_MS), longer than the whole function.
 *
 *   verify : timeout  5 s, retries 1  ->  2 * 5 + 1 * 15 = 25 s   (verify moves no funds; a 429 is worth one retry)
 *   settle : timeout 20 s, retries 0  ->  1 * 20         = 20 s   (see below)
 *
 *   Vercel limit 60 s, safety margin 3 s (cold init, writing the response) -> 57 s.
 *   25 s (verify) + 12 s (agent lookup allowance) + 20 s (settle) = 57 s.
 *
 * Settle uses retries 0 on purpose. The only refusals the SDK would retry are pre-execution ones (nothing moved);
 * a retry costs up to 15 s + a second timeout, and spending that would force the settle timeout down to 10 s
 * (retries 1: 2 * 10 + 15 = 35 s), which turns slow-but-successful settlements into ambiguous results.
 * A pre-execution 429/503 is answered 503 + Retry-After and the buyer resends the same credential.
 *
 * The agent lookup (`resolveAgent`) is application code with no overall deadline of its own, so the handler
 * starts settlement only if `elapsed + SETTLE_WORST_MS <= LIMIT - MARGIN` (see SETTLE_START_DEADLINE_MS). Anything
 * slower is answered 503 with nothing charged.
 *
 * Residual, not configurable in the SDK: the per-attempt timer is cleared when the response HEADERS arrive, so a
 * facilitator that sent headers and then stalled the body would not be cut off by `timeout`. The platform limit is
 * then the backstop, and the outcome is a lost response, which the Idempotency-Key makes safe to resend.
 */

import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { FacilitatorClient, MAX_RETRY_AFTER_SECONDS } from 'uvd-x402-sdk/backend'
import { FACILITATOR_BASE_URL, SERVICE_DESCRIPTION } from './x402-config.js'

// ── time budget (see the calculation above) ───────────────────────────────────

export const VERIFY_TIMEOUT_MS = 5_000
export const VERIFY_RETRIES = 1
export const SETTLE_TIMEOUT_MS = 20_000
export const SETTLE_RETRIES = 0

/** Vercel `maxDuration` of this function (vercel.json). */
export const FUNCTION_LIMIT_MS = 60_000
/** Reserved for cold init and writing the response. */
export const SAFETY_MARGIN_MS = 3_000

/** Worst-case duration of one SDK call: every attempt times out at its limit and every retry sleeps the maximum Retry-After. */
export function worstCaseMs(timeoutMs: number, retries: number): number {
  return (retries + 1) * timeoutMs + retries * MAX_RETRY_AFTER_SECONDS * 1000
}

export const VERIFY_WORST_MS = worstCaseMs(VERIFY_TIMEOUT_MS, VERIFY_RETRIES)   // 25 000
export const SETTLE_WORST_MS = worstCaseMs(SETTLE_TIMEOUT_MS, SETTLE_RETRIES)   // 20 000

/** Settlement may start only while the elapsed time is at or below this, so that it always ends inside the function limit. */
export const SETTLE_START_DEADLINE_MS = FUNCTION_LIMIT_MS - SAFETY_MARGIN_MS - SETTLE_WORST_MS   // 37 000

// ── SDK clients ───────────────────────────────────────────────────────────────

export type SdkPayment = Parameters<FacilitatorClient['verify']>[0]
export type SdkRequirements = Parameters<FacilitatorClient['verify']>[1]
export type SdkCallOptions = NonNullable<Parameters<FacilitatorClient['verify']>[2]>
export type SdkVerifyResult = Awaited<ReturnType<FacilitatorClient['verify']>>
export type SdkSettleResult = Awaited<ReturnType<FacilitatorClient['settle']>>

export interface PaymentFacilitator {
  verify(payment: SdkPayment, requirements: SdkRequirements, binding: SdkCallOptions): Promise<SdkVerifyResult>
  settle(payment: SdkPayment, requirements: SdkRequirements, binding: SdkCallOptions): Promise<SdkSettleResult>
}

/**
 * Two clients, one per phase, because `timeout` and `retries` are per-client options. No stack key is configured
 * (that credential is only for services run by Ultravioleta DAO); `UVD_STACK_KEY` must stay unset.
 */
export function createPaymentFacilitator(baseUrl: string = FACILITATOR_BASE_URL): PaymentFacilitator {
  const common = { baseUrl, x402Version: 2 as const }
  const verifier = new FacilitatorClient({ ...common, timeout: VERIFY_TIMEOUT_MS, retries: VERIFY_RETRIES })
  const settler = new FacilitatorClient({ ...common, timeout: SETTLE_TIMEOUT_MS, retries: SETTLE_RETRIES })
  return {
    verify: (payment, requirements, binding) => verifier.verify(payment, requirements, binding),
    settle: (payment, requirements, binding) => settler.settle(payment, requirements, binding),
  }
}

// ── adapters from our @x402/core objects to the SDK's request types ───────────

/** The signed payload in the shape `FacilitatorClient` takes. Only the signed `payload` is used by the SDK's v2 envelope. */
export function toSdkPayment(payload: PaymentPayload, matched: PaymentRequirements): SdkPayment {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: matched.network,
    payload: payload.payload,
  } as unknown as SdkPayment
}

/**
 * Our matched requirement in the SDK's requirement type. `resource` is the ACTUAL request URL (public origin, path and
 * query), as the SDK's own paywall advertises it (`resource: request.url`) and as the purchase context must equal.
 */
export function toSdkRequirements(matched: PaymentRequirements, resourceUrl: string): SdkRequirements {
  return {
    scheme:            matched.scheme,
    network:           matched.network,
    asset:             matched.asset,
    maxAmountRequired: matched.amount,
    payTo:             matched.payTo,
    resource:          resourceUrl,
    description:       SERVICE_DESCRIPTION,
    mimeType:          'application/json',
    maxTimeoutSeconds: matched.maxTimeoutSeconds,
    ...(matched.extra ? { extra: matched.extra } : {}),
  } as unknown as SdkRequirements
}
