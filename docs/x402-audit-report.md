# x402 Payment Handler Audit — `api/agent/paid.ts`

**Date:** 2026-10-12  
**Scope:** `api/agent/paid.ts`, `@circle-fin/x402-batching` SDK internals, x402 v2 specification  
**Status:** All findings fixed. 18/18 tests pass. tsc clean. Lint 0 errors.

---

## Summary

Five bugs were confirmed, all in `api/agent/paid.ts`. The most critical one
directly caused the reported `Unsupported payment network: unknown` failure when
paying on Base. Two additional issues caused spec non-compliance that would
break well-behaved x402 clients. One factual error in comments was also
corrected. No changes were made to any other file.

| # | Severity | Issue | Fixed |
|---|----------|-------|-------|
| 1 | **Critical** | Network read from wrong field → `unknown` | ✅ |
| 2 | **High** | Missing `PAYMENT-RESPONSE` header on success | ✅ |
| 3 | **High** | Wrong header name in `Access-Control-Allow-Headers` | ✅ |
| 4 | **Medium** | `PAYMENT-RESPONSE` absent from `Access-Control-Expose-Headers` | ✅ |
| 5 | **Low** | Stale comment claiming Arc Mainnet settlement unverified | ✅ |

---

## Finding 1 — CRITICAL: Wrong field read for payment network

**Root cause of `Unsupported payment network: unknown`.**

### What the x402 v2 spec says

The x402 v2 `PaymentPayload` wire schema (confirmed from `@x402/core` Zod schema
`PaymentPayloadV2Schema` and x402-foundation/x402 spec):

```json
{
  "x402Version": 2,
  "resource":  { "url": "...", "description": "...", "mimeType": "..." },
  "accepted":  {
    "scheme":  "exact",
    "network": "eip155:8453",       ← network lives HERE
    "asset":   "0x833589...",
    "amount":  "10000",
    "payTo":   "0x...",
    "maxTimeoutSeconds": 604900,
    "extra":   { ... }
  },
  "payload":   { "signature": "0x...", "authorization": { ... } },
  "extensions": {}
}
```

There is **no top-level `.network` field** in x402 v2. The chosen payment
network lives at `paymentPayload.accepted.network`.

### The bug

The old code read:

```typescript
// WRONG — these fields do not exist in x402 v2 PaymentPayload
const paymentNetwork =
  (paymentPayload as Record<string, unknown>).network ??
  (paymentPayload as Record<string, unknown>).x402Network ??
  'unknown'
```

Both `paymentPayload.network` and `paymentPayload.x402Network` are always
`undefined` in any compliant x402 v2 payload, so `paymentNetwork` was always
`'unknown'`, which matched no supported network.

### The fix

```typescript
// CORRECT — network is at accepted.network per x402 v2 spec
const paymentCaip2 = paymentPayload.accepted.network
```

`decodePaymentPayload()` now structurally validates that `accepted` is an object
and `accepted.network` is a string before returning a payload, so the network
extraction is always type-safe.

---

## Finding 2 — HIGH: Missing `PAYMENT-RESPONSE` header on success

The x402 v2 spec requires the server to send a `PAYMENT-RESPONSE` header on a
successful response. This header contains a base64-encoded settlement
confirmation object. Its absence causes x402 spec-compliant clients (including
the Circle CLI and `@circle-fin/x402-batching` client) to treat the response
as incomplete.

The `@circle-fin/x402-batching` Express middleware reference implementation
sends:

```typescript
res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({
  success:     true,
  transaction: settleResult.transaction,
  network:     requirements.network,
  payer:       settleResult.payer ?? verifyResult.payer ?? ""
})).toString("base64"));
```

The fix adds the same header to all three response paths: success, settled-but-404,
and settled-but-resolver-error. The `encodePaymentResponse()` helper handles
base64 encoding.

---

## Finding 3 — HIGH: Wrong header name in `Access-Control-Allow-Headers`

The old CORS configuration listed `X-PAYMENT` in `Allow-Headers`. The correct
x402 v2 client-to-server header name is `PAYMENT-SIGNATURE`. The x402 spec uses
`PAYMENT-SIGNATURE` exclusively. The `X-PAYMENT` alias only exists in the
**client** code of `@x402/core` as a compatibility alias, and it is not the
preferred name. Listing `X-PAYMENT` instead of `PAYMENT-SIGNATURE` causes CORS
preflight failures for clients that send the canonical `PAYMENT-SIGNATURE`.

Fix: `'Access-Control-Allow-Headers': 'Content-Type, PAYMENT-SIGNATURE'`

---

## Finding 4 — MEDIUM: `PAYMENT-RESPONSE` absent from `Access-Control-Expose-Headers`

Even though `PAYMENT-REQUIRED` was correctly listed in `Expose-Headers`, the
`PAYMENT-RESPONSE` header was not included. Browser-based x402 clients cannot
read the settlement confirmation without this. 

Fix: `'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE'`

---

## Finding 5 — LOW: Stale "Arc Mainnet unverified" comment

The previous comments and constraints stated Arc Mainnet Gateway settlement was
"uncertain and must be verified before advertising". Per Circle Gateway release
notes dated **2026-09-16**, Arc Mainnet was added as a supported blockchain for
Gateway. This was confirmed live by a direct call to
`GET https://gateway-api.circle.com/v1/x402/supported`, which returned
`eip155:5042` in the `kinds` array. The comment has been updated accordingly.

---

## Additional: Structural payload validation

The new `decodePaymentPayload()` function performs a minimal structural guard
before accepting any payload:

```typescript
if (
  typeof raw !== 'object' || raw === null ||
  typeof raw.accepted !== 'object' || raw.accepted === null ||
  typeof (raw.accepted as Record<string, unknown>).network !== 'string' ||
  typeof raw.payload !== 'object' || raw.payload === null
) {
  return null   // → 402 with payment_invalid
}
```

This prevents the handler from ever attempting to settle a malformed payload,
which would produce a confusing facilitator error rather than a clean 402.

---

## What was NOT changed

- Price ($0.01 USDC = `amount: "10000"`)
- ERC-8004 data source (always Arc Mainnet regardless of payment network)
- Supported payment networks (Arc, Base, Arbitrum)
- Facilitator URL (`https://gateway-api.circle.com`)
- `maxTimeoutSeconds` (604900 — 7 days + buffer per Gateway requirement)
- `api/_lib/resolve.ts`, `api/_lib/networks.ts`, or any other file
- Any frontend/UI/SEO/resolver file
- README.md

---

## Test coverage

`api/agent/__tests__/paid.test.ts` — 18 tests, all passing:

- Tests 2–5b: payload decode and `accepted.network` extraction
- Tests 6–7: network validation against supported set
- Tests 8–9: settlement mock encode/decode for `PAYMENT-RESPONSE`
- Tests 10–11: post-settlement 404/error paths preserve `paymentSettled` flag
- Test 12: CORS headers correctness
- Test 13: `maxTimeoutSeconds` and `amount` invariants
- Tests 14–15: structural guard rejects missing/null `.payload`

Run: `bun run api/agent/__tests__/paid.test.ts`
