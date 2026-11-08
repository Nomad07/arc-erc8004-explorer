// arc-studio-allow-onchain-literal
/**
 * Tests for GET /api/agent/paid (x402 v2 `exact`, Circle Facilitator Service).
 * Run with: bun test api
 *
 * The REAL handler and the REAL Circle client run against a scripted fake `fetch`.
 * No network access, no API key, no private key, no funds.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { validateAndExtract } from '@x402/extensions/bazaar'
import { recoverTypedDataAddress, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createPaidHandler, buildPaymentRequirements, type PaidHandlerDeps } from '../paid'
import { createCircleFacilitator } from '../../_lib/circle-facilitator'
import { DISCOVERY_OUTPUT_EXAMPLE, PAYMENT_NETWORKS } from '../../_lib/x402-config'
import openApiHandler from '../../openapi.json.ts'
import goneHandler from '../../agent'

const SELLER  = '0x1111111111111111111111111111111111111111'
const PAYER   = '0x2222222222222222222222222222222222222222'
const API_KEY = 'test-api-key-not-real-0123456789'
const TX      = `0x${'ab'.repeat(32)}`
const NONCE   = `0x${'cd'.repeat(32)}`

// Recorded from GET https://api.circle.com/v1/facilitator/x402/supported (exact kinds only).
const CIRCLE_SUPPORTED_EXACT = [
  { network: 'eip155:5042', asset: '0x3600000000000000000000000000000000000000', extra: { name: 'USDC', version: '2' } },
  { network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', extra: { name: 'USD Coin', version: '2' } },
]

// ── fakes ─────────────────────────────────────────────────────────────────────

interface FakeRes {
  statusCode: number
  headers: Record<string, string>
  body: unknown
  ended: boolean
  setHeader(k: string, v: string): FakeRes
  status(s: number): FakeRes
  json(b: unknown): FakeRes
  end(): FakeRes
}
function fakeRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 0, headers: {}, body: undefined, ended: false,
    setHeader(k, v) { r.headers[k] = v; return r },
    status(s) { r.statusCode = s; return r },
    json(b) { r.body = b; r.ended = true; return r },
    end() { r.ended = true; return r },
  }
  return r
}

interface Call { url: string; headers: Record<string, string>; body: Record<string, unknown> }
type Reply = Response | Error | (() => Response | Promise<Response>)

function scriptedFetch(script: { verify?: Reply; settle?: Reply }) {
  const calls: Call[] = []
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: input,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    const reply = input.endsWith('/verify') ? script.verify : input.endsWith('/settle') ? script.settle : undefined
    if (reply === undefined) throw new Error(`unscripted call ${input}`)
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply() : reply.clone()
  }
  return { calls, fetchImpl, count: (suffix: string) => calls.filter(c => c.url.endsWith(suffix)).length }
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const VERIFY_OK = ok({ isValid: true, payer: PAYER })
const SETTLE_OK = (net: string) => ok({ success: true, transaction: TX, network: net, payer: PAYER })
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

function makeDeps(
  script: { verify?: Reply; settle?: Reply },
  options: { resolveAgent?: PaidHandlerDeps['resolveAgent']; env?: Record<string, string | undefined> } = {},
) {
  const net = scriptedFetch(script)
  const resolveCalls: unknown[][] = []
  const deps: PaidHandlerDeps = {
    resolveAgent: options.resolveAgent ?? (async (...args: unknown[]) => {
      resolveCalls.push(args)
      return { ok: true as const, data: DISCOVERY_OUTPUT_EXAMPLE as never }
    }),
    createFacilitator: apiKey => createCircleFacilitator({ apiKey, fetchImpl: net.fetchImpl }),
    env: () => options.env ?? { SELLER_ADDRESS: SELLER, CIRCLE_FACILITATOR_API_KEY: API_KEY },
  }
  return { deps, net, resolveCalls }
}

function paymentFor(networkIndex: number, overrides: Partial<PaymentRequirements> = {}): PaymentPayload {
  const accepted = { ...buildPaymentRequirements(SELLER)[networkIndex], ...overrides }
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: { from: PAYER, to: SELLER, value: accepted.amount, validAfter: '0', validBefore: '9999999999', nonce: NONCE },
    },
  } as PaymentPayload
}

async function call(deps: PaidHandlerDeps, opts: { header?: string; query?: Record<string, string>; method?: string } = {}) {
  const res = fakeRes()
  const query = opts.query ?? { network: 'mainnet', agentId: '15' }
  await createPaidHandler(deps)(
    { method: opts.method ?? 'GET', headers: opts.header ? { 'payment-signature': opts.header } : {}, query } as never,
    res as never,
  )
  return res
}

const payHeader = (p: PaymentPayload) => encodePaymentSignatureHeader(p)

let errors: string[] = []
beforeEach(() => {
  errors = []
  spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')) })
  spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { (console.error as unknown as { mockRestore?: () => void }).mockRestore?.() })

// ── 402 challenge ─────────────────────────────────────────────────────────────

describe('unpaid request: 402 challenge', () => {
  it('returns 402 with exactly Arc and Base at 2000 units payable to SELLER_ADDRESS, without calling Circle', async () => {
    const { deps, net } = makeDeps({})
    const res = await call(deps)
    expect(res.statusCode).toBe(402)
    const header = decodePaymentRequiredHeader(res.headers['PAYMENT-REQUIRED'])
    expect(res.body).toEqual(header)
    expect(header.x402Version).toBe(2)
    expect(header.accepts).toHaveLength(2)
    expect(header.accepts.map(a => a.network)).toEqual(['eip155:5042', 'eip155:8453'])
    for (const a of header.accepts) {
      expect(a.scheme).toBe('exact')
      expect(a.amount).toBe('2000')
      expect(a.payTo).toBe(SELLER)
      expect(a.maxTimeoutSeconds).toBe(60)
    }
    expect(net.calls).toHaveLength(0)
  })

  it('uses the correct token address and EIP-712 domain per network (they differ)', async () => {
    const { deps } = makeDeps({})
    const header = decodePaymentRequiredHeader((await call(deps)).headers['PAYMENT-REQUIRED'])
    const [arc, base] = header.accepts
    expect(arc.asset).toBe('0x3600000000000000000000000000000000000000')
    expect(arc.extra).toEqual({ name: 'USDC', version: '2' })
    expect(base.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    expect(base.extra).toEqual({ name: 'USD Coin', version: '2' })
  })

  it('matches what Circle publishes in /supported for both networks', () => {
    for (const kind of CIRCLE_SUPPORTED_EXACT) {
      const ours = buildPaymentRequirements(SELLER).find(r => r.network === kind.network)
      expect(ours).toBeDefined()
      expect(ours?.asset).toBe(kind.asset)
      expect(ours?.extra).toEqual(kind.extra)
    }
  })

  it('does not offer Arbitrum, Gateway batching, or any third network', async () => {
    const { deps } = makeDeps({})
    const text = JSON.stringify((await call(deps)).body)
    expect(text).not.toContain('42161')
    expect(text).not.toContain('GatewayWalletBatched')
    expect(text).not.toContain('verifyingContract')
    expect(PAYMENT_NETWORKS).toHaveLength(2)
  })

  it('answers the challenge before validating the query (bare URL is 402, not 400)', async () => {
    const { deps } = makeDeps({})
    expect((await call(deps, { query: {} })).statusCode).toBe(402)
  })

  it('carries service metadata in the resource object', async () => {
    const { deps } = makeDeps({})
    const { resource } = decodePaymentRequiredHeader((await call(deps)).headers['PAYMENT-REQUIRED'])
    expect(resource.url).toBe('https://www.arcagents.app/api/agent/paid')
    expect(resource.serviceName).toBe('Arc ERC-8004 Explorer')
    expect(resource.description).toBe('Explore and retrieve ERC-8004 agent identity and registration data on Arc Mainnet and Testnet.')
    expect(resource.tags).toEqual(['arc', 'erc-8004', 'agents', 'blockchain', 'identity'])
    expect(resource.iconUrl).toBe('https://www.arcagents.app/icon-512.png')
  })
})

// ── Bazaar ────────────────────────────────────────────────────────────────────

describe('Bazaar discovery extension', () => {
  it('is present in the PAYMENT-REQUIRED header and the body, declares GET and the real inputs, and passes official validation', async () => {
    const { deps } = makeDeps({})
    const res = await call(deps)
    const fromHeader = decodePaymentRequiredHeader(res.headers['PAYMENT-REQUIRED'])
    const bazaarHeader = fromHeader.extensions?.bazaar as { info: { input: Record<string, unknown>; output: Record<string, unknown> }; schema: Record<string, unknown> }
    const bazaarBody = (res.body as { extensions: { bazaar: unknown } }).extensions.bazaar
    expect(bazaarHeader).toBeDefined()
    expect(bazaarBody).toEqual(bazaarHeader)
    expect(bazaarHeader.info.input.type).toBe('http')
    expect(bazaarHeader.info.input.method).toBe('GET')
    expect(bazaarHeader.info.input.queryParams).toEqual({ network: 'mainnet', agentId: 15 })
    expect(bazaarHeader.info.output.type).toBe('json')

    const checked = validateAndExtract(bazaarHeader as never)
    expect(checked.valid).toBe(true)

    const schema = bazaarHeader.schema as { properties: { input: { properties: { queryParams: { required: string[]; properties: Record<string, { type: string; enum?: string[]; minimum?: number }> } } }; output: { properties: { example: { required: string[] } } } } }
    const q = schema.properties.input.properties.queryParams
    expect(q.required).toEqual(['network', 'agentId'])
    expect(q.properties.network.enum).toEqual(['mainnet'])
    expect(q.properties.agentId.type).toBe('integer')
    expect(q.properties.agentId.minimum).toBe(1)
    expect(schema.properties.output.properties.example.required).toContain('identity')
  })

  it('output example is a real AgentResponse shape (all schema-required keys present)', () => {
    const required = ['agentId', 'network', 'chainId', 'identity', 'metadata', 'metadataError', 'reputation', 'validation', 'links', 'fetchedAt']
    for (const key of required) expect(DISCOVERY_OUTPUT_EXAMPLE).toHaveProperty(key)
  })

  it('a client that echoes the extension unchanged is accepted; a tampered echo is rejected', async () => {
    const { deps } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
    const challenge = decodePaymentRequiredHeader((await call(deps)).headers['PAYMENT-REQUIRED'])
    const good = { ...paymentFor(0), extensions: challenge.extensions }
    expect((await call(deps, { header: payHeader(good as PaymentPayload) })).statusCode).toBe(200)

    const tampered = JSON.parse(JSON.stringify(challenge.extensions)) as { bazaar: { info: { input: { method: string } } } }
    tampered.bazaar.info.input.method = 'POST'
    const bad = { ...paymentFor(0), extensions: tampered }
    const res = await call(makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') }).deps, { header: payHeader(bad as unknown as PaymentPayload) })
    expect(res.statusCode).toBe(402)
  })
})

// ── Circle configuration ──────────────────────────────────────────────────────

describe('Circle Facilitator configuration', () => {
  it('calls the Circle x402 endpoints with a Bearer key and the matched requirements', async () => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:8453') })
    const res = await call(deps, { header: payHeader(paymentFor(1)) })
    expect(res.statusCode).toBe(200)
    expect(net.calls.map(c => c.url)).toEqual([
      'https://api.circle.com/v1/facilitator/x402/verify',
      'https://api.circle.com/v1/facilitator/x402/settle',
    ])
    for (const c of net.calls) {
      expect(c.headers.Authorization).toBe(`Bearer ${API_KEY}`)
      expect(c.body.x402Version).toBe(2)
      const req = c.body.paymentRequirements as PaymentRequirements
      expect(req.network).toBe('eip155:8453')
      expect(req.amount).toBe('2000')
      expect(req.payTo).toBe(SELLER)
    }
  })

  it('missing CIRCLE_FACILITATOR_API_KEY: 500 server_misconfigured, Circle never called, key never echoed', async () => {
    const { deps, net } = makeDeps({}, { env: { SELLER_ADDRESS: SELLER } })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('server_misconfigured')
    expect(net.calls).toHaveLength(0)
  })

  it('missing or invalid SELLER_ADDRESS: 500 server_misconfigured', async () => {
    for (const seller of [undefined, 'not-an-address']) {
      const { deps } = makeDeps({}, { env: { SELLER_ADDRESS: seller, CIRCLE_FACILITATOR_API_KEY: API_KEY } })
      expect((await call(deps)).statusCode).toBe(500)
    }
  })
})

// ── request validation and bad payments (never reach Circle's settle) ─────────

describe('invalid requests and payments', () => {
  it('payment present but query invalid: 400 and no Circle call', async () => {
    for (const query of [{}, { network: 'mainnet' }, { agentId: '1' }, { network: 'testnet', agentId: '1' }, { network: 'base', agentId: '1' }, { network: 'mainnet', agentId: 'abc' }, { network: 'mainnet', agentId: '0' }]) {
      const { deps, net } = makeDeps({})
      expect((await call(deps, { header: payHeader(paymentFor(0)), query })).statusCode).toBe(400)
      expect(net.calls).toHaveLength(0)
    }
  })

  it('malformed or wrong-version payment header: 402 payment_invalid and no Circle call', async () => {
    for (const header of ['!!!not-base64!!!', Buffer.from('{"nope":1}').toString('base64'), payHeader({ ...paymentFor(0), x402Version: 1 } as unknown as PaymentPayload)]) {
      const { deps, net } = makeDeps({})
      const res = await call(deps, { header })
      expect(res.statusCode).toBe(402)
      expect((res.body as { error: string }).error).toBe('payment_invalid')
      expect(net.calls).toHaveLength(0)
    }
  })

  it('unsupported network, wrong amount, wrong payTo or Gateway-style payment: 402 and no Circle call', async () => {
    const cases: Partial<PaymentRequirements>[] = [
      { network: 'eip155:42161' },
      { amount: '10000' },
      { payTo: '0x3333333333333333333333333333333333333333' },
      { extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: '0x0000000000000000000000000000000000000001' } },
    ]
    for (const override of cases) {
      const { deps, net } = makeDeps({})
      const res = await call(deps, { header: payHeader(paymentFor(0, override)) })
      expect(res.statusCode).toBe(402)
      expect((res.body as { error: string }).error).toBe('payment_invalid')
      expect(net.calls).toHaveLength(0)
    }
  })

  it('verify says invalid: 402 payment_invalid, agent not resolved, settle not called', async () => {
    const { deps, net, resolveCalls } = makeDeps({ verify: ok({ isValid: false, invalidReason: 'invalid_exact_evm_payload_signature' }) })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(402)
    expect((res.body as { error: string }).error).toBe('payment_invalid')
    expect(net.count('/settle')).toBe(0)
    expect(resolveCalls).toHaveLength(0)
  })

  it('verify unavailable (timeout, network error, 401, 500): 503, not charged, settle not called', async () => {
    for (const verify of [abortError(), new Error('ECONNRESET'), ok({ code: 401, message: 'unauthorized' }, 401), ok({ code: 500, message: 'x' }, 500)] as Reply[]) {
      const { deps, net } = makeDeps({ verify })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(503)
      expect((res.body as { error: string }).error).toBe('payment_service_unavailable')
      expect(net.count('/settle')).toBe(0)
    }
  })
})

// ── failed lookups are never charged ──────────────────────────────────────────

describe('failed agent lookups are never charged', () => {
  it('404 and 503 from the resolver return before settle', async () => {
    const lookups: Array<[PaidHandlerDeps['resolveAgent'], number]> = [
      [async () => ({ ok: false as const, status: 404 as const, error: 'not_found', message: 'Agent #1 not found' }), 404],
      [async () => ({ ok: false as const, status: 503 as const, error: 'rpc_error', message: 'RPC failed' }), 503],
    ]
    for (const [resolveAgent, status] of lookups) {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') }, { resolveAgent })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(status)
      expect(res.headers['PAYMENT-RESPONSE']).toBeUndefined()
      expect(net.count('/settle')).toBe(0)
    }
  })

  it('resolver throwing returns 500 before settle', async () => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') }, { resolveAgent: async () => { throw new Error('boom') } })
    expect((await call(deps, { header: payHeader(paymentFor(0)) })).statusCode).toBe(500)
    expect(net.count('/settle')).toBe(0)
  })
})

// ── settlement outcomes ───────────────────────────────────────────────────────

describe('settlement', () => {
  for (const [label, index, network] of [['Arc', 0, 'eip155:5042'], ['Base', 1, 'eip155:8453']] as const) {
    it(`${label}: confirmed settlement returns the data and a PAYMENT-RESPONSE with the transaction`, async () => {
      const { deps, net, resolveCalls } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK(network) })
      const res = await call(deps, { header: payHeader(paymentFor(index)) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual(DISCOVERY_OUTPUT_EXAMPLE)
      expect(res.headers['Cache-Control']).toBe('no-store')
      const settled = decodePaymentResponseHeader(res.headers['PAYMENT-RESPONSE'])
      expect(settled).toMatchObject({ success: true, transaction: TX, network, payer: PAYER })
      expect(net.count('/settle')).toBe(1)
      expect(resolveCalls[0]).toEqual(['mainnet', 15, 15n])
    })
  }

  it('success without a valid hash, on another network, or with another amount returns NO data', async () => {
    const bad = [
      ok({ success: true, transaction: '', network: 'eip155:5042' }),
      ok({ success: true, transaction: '0x1234', network: 'eip155:5042' }),
      ok({ success: true, transaction: TX, network: 'eip155:8453' }),
      ok({ success: true, transaction: TX, network: 'eip155:5042', amount: '1' }),
    ]
    for (const settle of bad) {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(503)
      expect(res.body).not.toHaveProperty('identity')
      expect(res.headers['PAYMENT-RESPONSE']).toBeUndefined()
      expect(net.count('/settle')).toBe(1)
    }
  })

  it('definite failure (errorReason, or Circle 4xx) returns 402 payment_failed with no data', async () => {
    const failures = [
      ok({ success: false, errorReason: 'invalid_exact_evm_payload_signature', transaction: '', network: 'eip155:5042' }),
      ok({ code: 403, message: 'expired', errors: [{ reason: 'authorization_expired' }] }, 403),
      ok({ code: 409, message: 'reused', errors: [{ reason: 'authorization_reused' }] }, 409),
    ]
    for (const settle of failures) {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(402)
      expect((res.body as { error: string }).error).toBe('payment_failed')
      expect(res.body).not.toHaveProperty('identity')
      expect(net.count('/settle')).toBe(1)
    }
  })

  const ambiguous: Array<[string, Reply]> = [
    ['settlement_pending', ok({ success: false, errorReason: 'settlement_pending', transaction: '', network: 'eip155:5042', extensions: { 'settlement-status': { status: 'pending', paymentId: 'pay-123' } } })],
    ['timeout', abortError()],
    ['connection dropped', new Error('ECONNRESET')],
    ['HTTP 502', ok({ message: 'bad gateway' }, 502)],
    ['HTTP 500', ok({ code: 500, message: 'internal' }, 500)],
    ['non-JSON 200', new Response('<html>oops</html>', { status: 200 })],
    ['empty 200', new Response('', { status: 200 })],
    ['unexpected 200 shape', ok({ hello: 'world' })],
    ['recorded but not failed', ok({ success: false, errorReason: 'invalid_transaction_state', transaction: '', network: 'eip155:5042', extensions: { 'settlement-status': { status: 'pending', paymentId: 'pay-9' } } })],
  ]
  for (const [label, settle] of ambiguous) {
    it(`ambiguous (${label}): 503 payment_pending, no data, settle called exactly once, no secret logged`, async () => {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(503)
      expect((res.body as { error: string }).error).toBe('payment_pending')
      expect(res.body).not.toHaveProperty('identity')
      expect(res.headers['PAYMENT-RESPONSE']).toBeUndefined()
      expect(net.count('/settle')).toBe(1)
      const logged = errors.join('\n')
      expect(logged).toContain('AMBIGUOUS')
      expect(logged).not.toContain(API_KEY)
      expect(logged).not.toContain('11'.repeat(65))
    })
  }

  it('is stateless: an identical request is simply passed to Circle again (no server-side replay protection is claimed)', async () => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
    const header = payHeader(paymentFor(0))
    await call(deps, { header })
    await call(deps, { header })
    expect(net.count('/verify')).toBe(2)
    expect(net.count('/settle')).toBe(2)
  })
})

// ── interoperability with the official x402 client ────────────────────────────

describe('official x402 client interoperability (throwaway unfunded key, nothing is sent anywhere)', () => {
  for (const [label, index] of [['Arc', 0], ['Base', 1]] as const) {
    it(`${label}: a payload created by the official client is accepted and signed with the right EIP-712 domain`, async () => {
      const buyer = privateKeyToAccount(generatePrivateKey())
      const network = PAYMENT_NETWORKS[index]
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK(network.caip2) })

      const challenge = decodePaymentRequiredHeader((await call(deps)).headers['PAYMENT-REQUIRED'])
      // The SDK client's default spend controls do not know Arc's USDC, so a buyer on Arc must allow the asset.
      const client = new x402Client()
        .register(network.caip2 as `${string}:${string}`, new ExactEvmScheme(buyer))
        .setSpendControls({ allowedAssets: [{ network: network.caip2 as `${string}:${string}`, asset: network.asset, maxAmountPerPayment: '2000' }] })
      const payload = await new x402HTTPClient(client).createPaymentPayload({ ...challenge, accepts: [challenge.accepts[index]] })

      const res = await call(deps, { header: encodePaymentSignatureHeader(payload) })
      expect(res.statusCode).toBe(200)
      expect(net.count('/settle')).toBe(1)

      const sent = net.calls.find(c => c.url.endsWith('/verify'))?.body.paymentPayload as PaymentPayload
      const auth = (sent.payload as { authorization: Record<string, string>; signature: Hex }).authorization
      expect(auth.to.toLowerCase()).toBe(SELLER)
      expect(auth.value).toBe('2000')
      expect(auth.from.toLowerCase()).toBe(buyer.address.toLowerCase())

      // The signature must recover to the buyer under THIS network's domain (name differs per chain).
      const recovered = await recoverTypedDataAddress({
        domain: { name: network.domainName, version: network.domainVersion, chainId: Number(network.caip2.split(':')[1]), verifyingContract: network.asset as Hex },
        types: { TransferWithAuthorization: [
          { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
        ] },
        primaryType: 'TransferWithAuthorization',
        message: { from: auth.from as Hex, to: auth.to as Hex, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: auth.nonce as Hex },
        signature: (sent.payload as { signature: Hex }).signature,
      })
      expect(recovered.toLowerCase()).toBe(buyer.address.toLowerCase())
    })
  }
})

// ── CORS ──────────────────────────────────────────────────────────────────────

describe('CORS and methods', () => {
  it('OPTIONS preflight returns 204 allowing PAYMENT-SIGNATURE and exposing PAYMENT-REQUIRED and PAYMENT-RESPONSE', async () => {
    const res = await call(makeDeps({}).deps, { method: 'OPTIONS' })
    expect(res.statusCode).toBe(204)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.headers['Access-Control-Allow-Headers']).toContain('PAYMENT-SIGNATURE')
    expect(res.headers['Access-Control-Expose-Headers']).toContain('PAYMENT-REQUIRED')
    expect(res.headers['Access-Control-Expose-Headers']).toContain('PAYMENT-RESPONSE')
  })

  it('402, error and success responses all carry CORS headers; non-GET is 405', async () => {
    const challenge = await call(makeDeps({}).deps)
    expect(challenge.headers['Access-Control-Expose-Headers']).toContain('PAYMENT-RESPONSE')
    const paid = await call(makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') }).deps, { header: payHeader(paymentFor(0)) })
    expect(paid.headers['Access-Control-Allow-Origin']).toBe('*')
    expect((await call(makeDeps({}).deps, { method: 'POST' })).statusCode).toBe(405)
  })
})

// ── Circle client unit behaviour ──────────────────────────────────────────────

describe('Circle client', () => {
  it('sends one request per call (never retries) even when the reply is unusable', async () => {
    const net = scriptedFetch({ settle: ok({ message: 'x' }, 503) })
    const client = createCircleFacilitator({ apiKey: API_KEY, fetchImpl: net.fetchImpl })
    const out = await client.settle(paymentFor(0), buildPaymentRequirements(SELLER)[0], { network: 'eip155:5042', amount: '2000' })
    expect(out.kind).toBe('ambiguous')
    expect(net.count('/settle')).toBe(1)
  })

  it('strips a trailing slash from the base URL and uses the configured one', async () => {
    const net = scriptedFetch({ verify: VERIFY_OK })
    const client = createCircleFacilitator({ apiKey: API_KEY, baseUrl: 'https://example.test/x402/', fetchImpl: net.fetchImpl })
    await client.verify(paymentFor(0), buildPaymentRequirements(SELLER)[0])
    expect(net.calls[0].url).toBe('https://example.test/x402/verify')
  })
})

// ── repository guards: the migration is complete and nothing extra crept in ───

describe('repository guards', () => {
  const root = resolve(import.meta.dir, '../../..')
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
  const payment = ['api/agent/paid.ts', 'api/_lib/circle-facilitator.ts', 'api/_lib/x402-config.ts']

  it('payment code has no Gateway batching, Arbitrum, replay store or database', () => {
    for (const file of payment) {
      const src = read(file)
      for (const forbidden of ['GatewayWalletBatched', 'gateway-api.circle.com', 'x402-batching', 'BatchFacilitatorClient', '42161', 'Arbitrum', 'KV_REST_API', 'localStorage']) {
        expect(src.toLowerCase()).not.toContain(forbidden.toLowerCase())
      }
      // Whole-word match: "declareDiscoveryExtension" must not trip the "redis" check.
      expect(src).not.toMatch(/\b(redis|upstash|ioredis|sqlite|postgres)\b/i)
    }
    expect(existsSyncSafe(resolve(root, 'api/_lib/replay.ts'))).toBe(false)
  })

  it('reads only SELLER_ADDRESS and CIRCLE_FACILITATOR_API_KEY from the environment', () => {
    const vars = new Set(payment.flatMap(f => [...read(f).matchAll(/env\.([A-Z0-9_]+)/g)].map(m => m[1])))
    expect([...vars].sort()).toEqual(['CIRCLE_FACILITATOR_API_KEY', 'SELLER_ADDRESS'])
  })

  it('package.json no longer depends on the Gateway batching package and keeps the x402 packages aligned', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@circle-fin/x402-batching']).toBeUndefined()
    expect(pkg.dependencies['@x402/extensions']).toBe('2.27.0')
  })
})

function existsSyncSafe(path: string): boolean {
  try { readFileSync(path); return true } catch { return false }
}

// ── unchanged free endpoints and the OpenAPI document ─────────────────────────

describe('free endpoints and OpenAPI document', () => {
  it('GET /api/agent is still retired (410)', () => {
    const res = fakeRes()
    goneHandler({ method: 'GET' } as never, res as never)
    expect(res.statusCode).toBe(410)
  })

  it('OpenAPI is served freely, marks itself security: [], prices the paid endpoint at 0.002 with Arc and Base only', () => {
    const res = fakeRes()
    openApiHandler({ method: 'GET' } as never, res as never)
    expect(res.statusCode).toBe(200)
    const spec = res.body as { paths: Record<string, { get: Record<string, unknown> }> }
    expect(spec.paths['/api/openapi.json'].get.security).toEqual([])
    const paid = spec.paths['/api/agent/paid'].get as { 'x-payment-info': { price: { amount: string }; protocols: unknown[] } }
    expect(paid['x-payment-info'].price.amount).toBe('0.002000')
    expect(paid['x-payment-info'].protocols).toEqual([{ x402: {} }])
    const text = JSON.stringify(spec)
    expect(text).not.toContain('42161')
    expect(text).not.toContain('Arbitrum')
    expect(text).not.toContain('GatewayWalletBatched')
    expect(text).toContain('eip155:5042')
    expect(text).toContain('eip155:8453')
  })
})
