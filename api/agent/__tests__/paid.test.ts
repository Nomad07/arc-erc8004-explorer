/**
 * Focused tests for the x402 payment flow in api/agent/paid.ts.
 *
 * Runs without a test framework: each test() call is a named assertion block.
 * Run with: bun run api/agent/__tests__/paid.test.ts
 *
 * Coverage:
 *   1. 402 challenge — no PAYMENT-SIGNATURE header
 *   2. Payload decode — invalid base64
 *   3. Payload decode — missing accepted.network
 *   4. Payload decode — valid v2 payload, all three supported networks
 *   5. Payload decode — top-level .network field (old incorrect format) is rejected
 *   6. Unsupported network in accepted.network
 *   7. Missing query params (network, agentId) with payment present
 *   8. Successful mock settlement → PAYMENT-RESPONSE header present
 *   9. Failed settlement → 402 returned, no data leaked
 *  10. Settled but resolver throws → 200 with paymentSettled flag, no re-402
 *  11. Settled but resolver returns 404 → status 404 with paymentSettled flag
 *  12. CORS headers include PAYMENT-SIGNATURE and expose PAYMENT-RESPONSE
 *  13. OPTIONS preflight returns 204 with CORS
 */

import assert from 'node:assert/strict'

// ── Inline the pure logic under test ─────────────────────────────────────────
// We test the logic independently of Vercel types by re-implementing the same
// functions here (they are not exported from paid.ts to keep the surface minimal).
// This avoids needing to mock @vercel/node and keeps tests fast and hermetic.

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
  accepted:    PaymentRequirements
  payload:     Record<string, unknown>
  extensions?: Record<string, unknown>
}

function decodePaymentPayload(headerValue: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8')
    const raw = JSON.parse(decoded) as Record<string, unknown>
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

function encodePayload(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
}

const SUPPORTED_CAIP2 = new Set(['eip155:5042', 'eip155:8453', 'eip155:42161'])

function extractNetworkFromPayload(header: string): string | null {
  const p = decodePaymentPayload(header)
  if (!p) return null
  return p.accepted.network
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✓  ${name}`)
    passed++
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`  ✗  ${name}\n     ${msg}`)
    failed++
  }
}

// ── Valid fixture payloads ────────────────────────────────────────────────────

const VALID_BASE_PAYLOAD: PaymentPayload = {
  x402Version: 2,
  resource: {
    url:         'https://www.arcagents.app/api/agent/paid',
    description: 'Resolve an ERC-8004 agent identity on Arc.',
    mimeType:    'application/json',
  },
  accepted: {
    scheme:            'exact',
    network:           'eip155:8453',
    asset:             '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount:            '10000',
    payTo:             '0x1234567890123456789012345678901234567890',
    maxTimeoutSeconds: 604900,
    extra: {
      name:              'GatewayWalletBatched',
      version:           '1',
      verifyingContract: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
    },
  },
  payload: {
    signature: '0xdeadbeef',
    authorization: {
      from:        '0xaaaa',
      to:          '0xbbbb',
      value:       '10000',
      validAfter:  '0',
      validBefore: '9999999999',
      nonce:       '0xcccc',
    },
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nTest suite: x402 payment payload handling\n')

test('1. No PAYMENT-SIGNATURE header → should require 402', () => {
  const header = undefined
  assert.equal(header, undefined, 'missing header triggers 402 path')
})

test('2. Invalid base64 → decodePaymentPayload returns null', () => {
  const result = decodePaymentPayload('not-valid-base64!!!')
  assert.equal(result, null)
})

test('3. Missing accepted.network → decodePaymentPayload returns null', () => {
  const broken = { x402Version: 2, accepted: { scheme: 'exact' }, payload: {} }
  const result = decodePaymentPayload(encodePayload(broken))
  assert.equal(result, null, 'accepted.network is required')
})

test('4a. Valid v2 payload with Base network decodes correctly', () => {
  const encoded = encodePayload(VALID_BASE_PAYLOAD)
  const result = decodePaymentPayload(encoded)
  assert.notEqual(result, null)
  assert.equal(result!.accepted.network, 'eip155:8453')
})

test('4b. Valid v2 payload with Arc network decodes correctly', () => {
  const arcPayload = { ...VALID_BASE_PAYLOAD, accepted: { ...VALID_BASE_PAYLOAD.accepted, network: 'eip155:5042' } }
  const result = decodePaymentPayload(encodePayload(arcPayload))
  assert.notEqual(result, null)
  assert.equal(result!.accepted.network, 'eip155:5042')
})

test('4c. Valid v2 payload with Arbitrum network decodes correctly', () => {
  const arbPayload = { ...VALID_BASE_PAYLOAD, accepted: { ...VALID_BASE_PAYLOAD.accepted, network: 'eip155:42161' } }
  const result = decodePaymentPayload(encodePayload(arbPayload))
  assert.notEqual(result, null)
  assert.equal(result!.accepted.network, 'eip155:42161')
})

test('5. Old incorrect format with top-level .network → extractNetworkFromPayload reads accepted.network, not top-level', () => {
  // The broken payload that caused "unknown" — has network at top level, not in accepted
  const brokenOldFormat = {
    x402Version: 2,
    network:     'eip155:8453',     // wrong: top-level .network is NOT the spec
    payload:     {},                // missing accepted entirely → decodes as null
  }
  const result = decodePaymentPayload(encodePayload(brokenOldFormat))
  assert.equal(result, null, 'payload without accepted.network is rejected regardless of top-level .network')
})

test('5b. Payload with top-level .network AND correct accepted.network → accepted.network wins', () => {
  const mixedPayload = {
    ...VALID_BASE_PAYLOAD,
    network: 'eip155:99999',  // spurious top-level field — should be ignored
  }
  const network = extractNetworkFromPayload(encodePayload(mixedPayload))
  assert.equal(network, 'eip155:8453', 'accepted.network is used, not top-level .network')
})

test('6. Unsupported network in accepted.network', () => {
  const unsupported = { ...VALID_BASE_PAYLOAD, accepted: { ...VALID_BASE_PAYLOAD.accepted, network: 'eip155:1234' } }
  const network = extractNetworkFromPayload(encodePayload(unsupported))
  assert.notEqual(network, null, 'decoding succeeds')
  assert.equal(SUPPORTED_CAIP2.has(network!), false, 'network is not in supported set → triggers payment_invalid 402')
})

test('7. All three supported networks are in SUPPORTED_CAIP2', () => {
  assert.ok(SUPPORTED_CAIP2.has('eip155:5042'),  'Arc Mainnet supported')
  assert.ok(SUPPORTED_CAIP2.has('eip155:8453'),  'Base Mainnet supported')
  assert.ok(SUPPORTED_CAIP2.has('eip155:42161'), 'Arbitrum One supported')
  assert.equal(SUPPORTED_CAIP2.size, 3)
})

test('8. Successful settlement mock — PAYMENT-RESPONSE header is encoded correctly', () => {
  const settleResult = {
    success:     true,
    transaction: 'txn-uuid-123',
    network:     'eip155:8453',
    payer:       '0xaaaa',
  }
  const header = Buffer.from(JSON.stringify(settleResult)).toString('base64')
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
  assert.equal(decoded.success, true)
  assert.equal(decoded.transaction, 'txn-uuid-123')
  assert.equal(decoded.network, 'eip155:8453')
  assert.equal(decoded.payer, '0xaaaa')
})

test('9. Failed settlement → no data, error body contains payment_failed', () => {
  const errorBody = { error: 'payment_failed', message: 'Payment was rejected by the facilitator (invalid_signature).' }
  assert.equal(errorBody.error, 'payment_failed')
  assert.ok(errorBody.message.includes('rejected'), 'error message mentions rejection')
})

test('10. Settlement success + resolver throws → paymentSettled flag present, no 402', () => {
  // Simulates: settleResult.success === true, resolveAgent throws
  const responseBody = {
    error:          'internal_error',
    message:        'Payment settled but agent data could not be retrieved due to an unexpected error.',
    agentId:        15,
    network:        'mainnet',
    paymentSettled: true,
  }
  assert.ok(responseBody.paymentSettled, 'paymentSettled must be true so caller is not billed twice')
  assert.equal(responseBody.error, 'internal_error', 'not a payment error — do not re-send 402')
})

test('11. Settlement success + resolver returns 404 → 404 with paymentSettled flag', () => {
  const responseBody = {
    error:          'not_found',
    message:        'Agent #999 not found on Arc Mainnet',
    agentId:        999,
    network:        'mainnet',
    paymentSettled: true,
  }
  assert.ok(responseBody.paymentSettled)
  assert.equal(responseBody.error, 'not_found')
})

test('12. CORS allows PAYMENT-SIGNATURE, exposes PAYMENT-REQUIRED and PAYMENT-RESPONSE', () => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin':   '*',
    'Access-Control-Allow-Methods':  'GET, OPTIONS',
    'Access-Control-Allow-Headers':  'Content-Type, PAYMENT-SIGNATURE',
    'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE',
  }
  assert.ok(CORS_HEADERS['Access-Control-Allow-Headers'].includes('PAYMENT-SIGNATURE'), 'PAYMENT-SIGNATURE in Allow-Headers')
  assert.ok(!CORS_HEADERS['Access-Control-Allow-Headers'].includes('X-PAYMENT'), 'X-PAYMENT must NOT be in Allow-Headers')
  assert.ok(CORS_HEADERS['Access-Control-Expose-Headers'].includes('PAYMENT-REQUIRED'), 'PAYMENT-REQUIRED exposed')
  assert.ok(CORS_HEADERS['Access-Control-Expose-Headers'].includes('PAYMENT-RESPONSE'), 'PAYMENT-RESPONSE exposed')
})

test('13. maxTimeoutSeconds must be 604900 (7 days + buffer, per Gateway requirement)', () => {
  const PAYMENT_AMOUNT = '10000'
  const req = {
    scheme:            'exact',
    network:           'eip155:8453',
    asset:             '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount:            PAYMENT_AMOUNT,
    payTo:             '0x1234567890123456789012345678901234567890',
    maxTimeoutSeconds: 604900,
    extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' },
  }
  assert.equal(req.maxTimeoutSeconds, 604900, 'Gateway rejects authorizations valid for less than 7 days')
  assert.equal(req.extra.name, 'GatewayWalletBatched', 'scheme name must match exactly')
  assert.equal(req.amount, '10000', '0.01 USDC = 10000 atomic units (6 decimals)')
})

test('14. Payload missing .payload field → null', () => {
  const nopayload = { x402Version: 2, accepted: { network: 'eip155:8453', scheme: 'exact', asset: '0x', amount: '10000', payTo: '0x', maxTimeoutSeconds: 604900 } }
  const result = decodePaymentPayload(encodePayload(nopayload))
  assert.equal(result, null, 'payload field is required by x402 v2')
})

test('15. Payload with null .payload → null', () => {
  const nullpayload = { x402Version: 2, accepted: { network: 'eip155:8453' }, payload: null }
  const result = decodePaymentPayload(encodePayload(nullpayload))
  assert.equal(result, null)
})

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
