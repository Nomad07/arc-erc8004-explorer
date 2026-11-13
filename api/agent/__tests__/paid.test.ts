// arc-studio-allow-onchain-literal
/**
 * Tests for GET /api/agent/paid (x402 v2 `exact`, Ultravioleta DAO facilitator).
 * Run with: bun test api
 *
 * The REAL handler runs with the REAL official `FacilitatorClient` (uvd-x402-sdk 2.114.0) against a scripted
 * fake `fetch` that replays mocked Ultravioleta responses. No network access, no API key, no real wallet, no funds:
 * every signature below is a placeholder or comes from a throwaway key.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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
import { chainToCAIP2, getChainByName, receiptCommitment } from 'uvd-x402-sdk'
import { recoverTypedDataAddress, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createPaidHandler, buildPaymentRequirements, type PaidHandlerDeps } from '../paid'
import {
  FUNCTION_LIMIT_MS, SAFETY_MARGIN_MS, SETTLE_RETRIES, SETTLE_START_DEADLINE_MS, SETTLE_TIMEOUT_MS, SETTLE_WORST_MS,
  VERIFY_RETRIES, VERIFY_TIMEOUT_MS, VERIFY_WORST_MS, createPaymentFacilitator, worstCaseMs,
} from '../../_lib/x402-facilitator'
import { DISCOVERY_OUTPUT_EXAMPLE, FACILITATOR_BASE_URL, PAYMENT_NETWORKS, SERVICE_DESCRIPTION } from '../../_lib/x402-config'
import openApiHandler from '../../openapi.json.ts'
import goneHandler from '../../agent'

const SELLER  = '0x1111111111111111111111111111111111111111'
const PAYER   = '0x2222222222222222222222222222222222222222'
const TX      = `0x${'ab'.repeat(32)}`
const NONCE   = `0x${'cd'.repeat(32)}`
const PAYMENT_ID = `0x${'ef'.repeat(32)}`
const UVD = FACILITATOR_BASE_URL
const REQUEST_URL = 'https://www.arcagents.app/api/agent/paid?network=mainnet&agentId=15'

// Recorded from GET https://facilitator.ultravioletadao.xyz/supported (x402 v2, scheme exact).
// Arc and Base are listed under their CAIP-2 id, with `arc` / `base` as aliases.
const UVD_SUPPORTED_EXACT = [
  { x402Version: 2, scheme: 'exact', network: 'eip155:5042', networkAliases: ['arc', 'eip155:5042'], usdc: '0x3600000000000000000000000000000000000000' },
  { x402Version: 2, scheme: 'exact', network: 'eip155:8453', networkAliases: ['base', 'eip155:8453'], usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
]

// ── fakes ─────────────────────────────────────────────────────────────────────

interface FakeRes {
  statusCode: number
  headers: Record<string, string>
  body: unknown
  ended: boolean
  setHeader(k: string, v: string): FakeRes
  getHeader(k: string): string | undefined
  status(s: number): FakeRes
  json(b: unknown): FakeRes
  end(): FakeRes
}
function fakeRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 0, headers: {}, body: undefined, ended: false,
    setHeader(k, v) { r.headers[k] = v; return r },
    getHeader(k) { return r.headers[k] },
    status(s) { r.statusCode = s; return r },
    json(b) { r.body = b; r.ended = true; return r },
    end() { r.ended = true; return r },
  }
  return r
}

/** One request seen by the fake facilitator. Header names are lower-cased. */
interface Call { url: string; headers: Record<string, string>; body: Record<string, unknown> }
type Reply = Response | Error | (() => Response | Promise<Response>)

function scriptedFetch(script: { verify?: Reply; settle?: Reply }) {
  const calls: Call[] = []
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: input,
      headers: Object.fromEntries(new Headers(init?.headers as HeadersInit | undefined).entries()),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    const reply = input.endsWith('/verify') ? script.verify : input.endsWith('/settle') ? script.settle : undefined
    if (reply === undefined) throw new Error(`unscripted call ${input}`)
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply() : reply.clone()
  }
  return { calls, fetchImpl, count: (suffix: string) => calls.filter(c => c.url.endsWith(suffix)).length }
}

/** The official FacilitatorClient calls the global fetch: install the fake for the length of one test. */
const restorers: Array<() => void> = []
function installFetch(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>) {
  const real = globalThis.fetch
  globalThis.fetch = ((input: unknown, init?: RequestInit) => fetchImpl(String(input), init)) as typeof fetch
  restorers.push(() => { globalThis.fetch = real })
}

/** Successive replies; the last one repeats. */
function sequence(replies: Reply[]): Reply {
  let i = 0
  return async () => {
    const reply = replies[Math.min(i++, replies.length - 1)]
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply() : reply.clone()
  }
}

const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const VERIFY_OK = ok({ isValid: true, payer: PAYER })
// Ultravioleta may echo the network as a short alias (`base`, `arc`) or as CAIP-2.
const SETTLE_OK = (net: string) => ok({ success: true, transaction: TX, transactionHash: TX, paymentId: PAYMENT_ID, network: net, payer: PAYER })
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

/** A facilitator receipt the official SDK accepts (schema version 1, request hash committed). */
function makeReceipt(index: number, status: 'pending' | 'unknown' | 'confirmed', overrides: Record<string, unknown> = {}) {
  const req = buildPaymentRequirements(SELLER)[index]
  const request = { network: req.network, scheme: 'exact', asset: req.asset, amount: req.amount, payTo: req.payTo, purchaseId: null }
  return {
    schemaVersion: 1, status, revision: 1, receiptId: 'rcpt_1', issuer: 'uvd', operation: 'settle',
    network: req.network, scheme: 'exact', asset: req.asset, amount: req.amount, payTo: req.payTo,
    paymentRequestHash: 'a'.repeat(64), authorizationId: 'b'.repeat(64), purchaseId: null,
    request, requestHashVersion: 'uvd-x402-request-v1', requestHash: receiptCommitment('uvd-x402-request-v1', request),
    retry: { safe: status !== 'confirmed' },
    ...(status === 'confirmed' ? { settlement: { id: TX } } : {}),
    ...overrides,
  }
}

function makeDeps(
  script: { verify?: Reply; settle?: Reply },
  options: { resolveAgent?: PaidHandlerDeps['resolveAgent']; env?: Record<string, string | undefined>; now?: () => number } = {},
) {
  const net = scriptedFetch(script)
  installFetch(net.fetchImpl)
  const resolveCalls: unknown[][] = []
  const deps: PaidHandlerDeps = {
    resolveAgent: options.resolveAgent ?? (async (...args: unknown[]) => {
      resolveCalls.push(args)
      return { ok: true as const, data: DISCOVERY_OUTPUT_EXAMPLE as never }
    }),
    facilitator: createPaymentFacilitator(),     // the REAL official FacilitatorClient, talking to the fake fetch
    env: () => options.env ?? { SELLER_ADDRESS: SELLER },
    ...(options.now ? { now: options.now } : {}),
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

async function call(deps: PaidHandlerDeps, opts: { header?: string; query?: Record<string, string>; method?: string; purchase?: string } = {}) {
  const res = fakeRes()
  const query = opts.query ?? { network: 'mainnet', agentId: '15' }
  await createPaidHandler(deps)(
    {
      method: opts.method ?? 'GET',
      url: `/api/agent/paid?${new URLSearchParams(query).toString()}`,
      headers: {
        ...(opts.header ? { 'payment-signature': opts.header } : {}),
        ...(opts.purchase !== undefined ? { 'x-uvd-purchase': opts.purchase } : {}),
      },
      query,
    } as never,
    res as never,
  )
  return res
}

const payHeader = (p: PaymentPayload) => encodePaymentSignatureHeader(p)

/** No paid data and never a success receipt may accompany an unconfirmed result (a stated failure may carry success:false). */
function expectNothingReleased(res: FakeRes) {
  expect(res.body).not.toHaveProperty('identity')
  const receipt = res.headers['PAYMENT-RESPONSE']
  if (receipt !== undefined) expect(decodePaymentResponseHeader(receipt).success).toBe(false)
  else expect(res.headers['X-PAYMENT-RESPONSE']).toBeUndefined()
}

let errors: string[] = []
beforeEach(() => {
  errors = []
  spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')) })
  spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  (console.error as unknown as { mockRestore?: () => void }).mockRestore?.()
  while (restorers.length) restorers.pop()!()
})

// ── 402 challenge ─────────────────────────────────────────────────────────────

describe('unpaid request: 402 challenge', () => {
  it('returns 402 with exactly Arc and Base at 2000 units payable to SELLER_ADDRESS, without calling the facilitator', async () => {
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

  it('matches what Ultravioleta publishes in /supported (x402 v2 exact) for both networks', () => {
    for (const kind of UVD_SUPPORTED_EXACT) {
      expect(kind.x402Version).toBe(2)
      expect(kind.scheme).toBe('exact')
      const ours = buildPaymentRequirements(SELLER).find(r => r.network === kind.network)
      expect(ours).toBeDefined()
      expect(ours?.scheme).toBe('exact')
      expect(ours?.asset).toBe(kind.usdc)
      expect(ours?.amount).toBe('2000')
      // /supported advertises the short alias too; the SDK registry maps it to the same CAIP-2 id.
      for (const alias of kind.networkAliases.filter(a => !a.includes(':'))) expect(chainToCAIP2(alias)).toBe(kind.network)   // the SDK's own registry
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
    expect(resource.description).toBe('Retrieve ERC-8004 agent identity and registration data from Arc Mainnet through x402 v2 payments.')
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

// ── facilitator configuration (what the official FacilitatorClient is given and sends) ─────

describe('Ultravioleta facilitator configuration', () => {
  for (const [label, index, network] of [['Arc', 0, 'eip155:5042'], ['Base', 1, 'eip155:8453']] as const) {
    it(`${label}: FacilitatorClient calls /verify then /settle on the Ultravioleta host: no credential, one shared key, the v2 envelope`, async () => {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK(network) })
      const res = await call(deps, { header: payHeader(paymentFor(index)) })
      expect(res.statusCode).toBe(200)
      expect(UVD).toBe('https://facilitator.ultravioletadao.xyz')
      expect(net.calls.map(c => c.url)).toEqual([`${UVD}/verify`, `${UVD}/settle`])
      for (const c of net.calls) {
        // Content-type and the Idempotency-Key only: no Authorization, no stack key, no purchase context.
        expect(Object.keys(c.headers).sort()).toEqual(['content-type', 'idempotency-key'])
        expect(c.headers['idempotency-key']).toMatch(/^x402-[0-9a-f]{64}$/)
        expect(c.body.x402Version).toBe(2)
        const accepted = c.body.accepted as PaymentRequirements
        expect(accepted).toEqual({ ...buildPaymentRequirements(SELLER)[index] })   // OUR requirement, incl. the signing-domain extra
        expect(accepted.network).toBe(network)
        expect(accepted.amount).toBe('2000')
        expect(accepted.payTo).toBe(SELLER)
        expect(accepted.maxTimeoutSeconds).toBe(60)
        // The payment resource is the ACTUAL request URL, as the SDK's own paywall advertises it.
        expect(c.body.resource).toEqual({ url: REQUEST_URL, description: SERVICE_DESCRIPTION, mimeType: 'application/json' })
        expect(Object.keys(c.body).sort()).toEqual(['accepted', 'paymentPayload', 'resource', 'x402Version'])
        expect(Object.keys(c.body.paymentPayload as object).sort()).toEqual(['accepted', 'payload', 'resource', 'x402Version'])
        expect(c.body).not.toHaveProperty('paymentRequirements')
      }
      // ONE key for the payment: the same on verify and settle.
      expect(net.calls[0].headers['idempotency-key']).toBe(net.calls[1].headers['idempotency-key'])
    })
  }

  it('each request gets its own fresh random key; nothing is derived from the payment', async () => {
    const keys = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
      await call(deps, { header: payHeader(paymentFor(0)) })
      keys.add(net.calls[0].headers['idempotency-key'])
    }
    expect(keys.size).toBe(3)
    expect(JSON.stringify([...keys])).not.toContain(NONCE.slice(2))
  })

  it('the facilitator receives OUR requirement and nothing else the buyer added', async () => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
    const payment = { ...paymentFor(0), extraBuyerKey: 'buyer-supplied' } as PaymentPayload
    ;(payment.accepted as unknown as Record<string, unknown>).extraneous = 'buyer-supplied'
    await call(deps, { header: payHeader(payment) })
    for (const c of net.calls) expect(JSON.stringify(c.body)).not.toMatch(/buyer-supplied|extensions|bazaar/)
  })

  it('needs only SELLER_ADDRESS: no API key is required, read or sent', async () => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') }, { env: { SELLER_ADDRESS: SELLER } })
    expect((await call(deps, { header: payHeader(paymentFor(0)) })).statusCode).toBe(200)
    for (const c of net.calls) expect(Object.keys(c.headers)).not.toContain('authorization')
  })

  it('missing or invalid SELLER_ADDRESS: 500 server_misconfigured and the facilitator is never called', async () => {
    for (const seller of [undefined, 'not-an-address']) {
      const { deps, net } = makeDeps({}, { env: { SELLER_ADDRESS: seller } })
      expect((await call(deps)).statusCode).toBe(500)
      expect(net.calls).toHaveLength(0)
    }
  })
})

// ── request validation and bad payments (never reach the facilitator) ────────

describe('invalid requests and payments', () => {
  it('payment present but query invalid: 400 and no facilitator call', async () => {
    for (const query of [{}, { network: 'mainnet' }, { agentId: '1' }, { network: 'testnet', agentId: '1' }, { network: 'base', agentId: '1' }, { network: 'mainnet', agentId: 'abc' }, { network: 'mainnet', agentId: '0' }]) {
      const { deps, net } = makeDeps({})
      expect((await call(deps, { header: payHeader(paymentFor(0)), query })).statusCode).toBe(400)
      expect(net.calls).toHaveLength(0)
    }
  })

  it('malformed or wrong-version payment header: 402 payment_invalid and no facilitator call', async () => {
    for (const header of ['!!!not-base64!!!', Buffer.from('{"nope":1}').toString('base64'), payHeader({ ...paymentFor(0), x402Version: 1 } as unknown as PaymentPayload)]) {
      const { deps, net } = makeDeps({})
      const res = await call(deps, { header })
      expect(res.statusCode).toBe(402)
      expect((res.body as { error: string }).error).toBe('payment_invalid')
      expect(net.calls).toHaveLength(0)
    }
  })

  it('unsupported network, wrong amount, wrong payTo or Gateway-style payment: 402 and no facilitator call', async () => {
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

  for (const [label, index] of [['Arc', 0], ['Base', 1]] as const) {
    it(`${label}: verify refuses the payment (isValid:false): 402 with the challenge, the SDK's reason, agent not resolved, settle not called`, async () => {
      for (const invalidReason of ['invalid_signature', 'invalid_timing', 'insufficient_funds', 'receiver_mismatch']) {
        const { deps, net, resolveCalls } = makeDeps({ verify: ok({ isValid: false, invalidReason, payer: PAYER }) })
        const res = await call(deps, { header: payHeader(paymentFor(index)) })
        expect(res.statusCode).toBe(402)
        expect(res.body).toEqual({ error: 'Payment verification failed', reason: invalidReason })
        expect(res.headers['PAYMENT-REQUIRED']).toBeDefined()   // the buyer gets the challenge again
        expect(net.count('/settle')).toBe(0)
        expect(resolveCalls).toHaveLength(0)
      }
    })
  }

  it('a verify refusal in the facilitator\'s {error, code} format is also a rejected payment (402)', async () => {
    const { deps, net } = makeDeps({ verify: ok({ error: 'invalid_network', code: 'invalid_network' }, 400) })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(402)
    expect((res.body as { reason: string }).reason).toContain('invalid_network')
    expect(net.count('/settle')).toBe(0)
  })

  it('verify reached no verdict (timeout, connection error, 502, plain 503): 503 + Retry-After, nothing settled, never a rejection', async () => {
    const replies: Reply[] = [abortError(), new Error('ECONNRESET'), ok({ error: 'bad_gateway' }, 502), ok({ error: 'unavailable' }, 503)]
    for (const verify of replies) {
      const { deps, net, resolveCalls } = makeDeps({ verify })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(503)
      expect(res.headers['Retry-After']).toBe('5')           // the SDK's default pause
      expect(res.body).toMatchObject({ error: 'Payment verification unavailable', retryable: true })
      expect(res.headers['PAYMENT-REQUIRED']).toBeUndefined()   // not a 402: a new signature would be a second payment
      expect(net.count('/settle')).toBe(0)
      expect(resolveCalls).toHaveLength(0)
    }
  })

  it('authorization already used or in flight at verify: 409 / 503, never served, never settled, never a 402', async () => {
    const used: Reply[] = [ok({ isValid: false, invalidReason: 'authorization_already_settled' }), ok({ error: 'authorization_already_settled' }, 409)]
    for (const verify of used) {
      const { deps, net, resolveCalls } = makeDeps({ verify })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(409)
      expect(res.body).toMatchObject({ error: 'Payment authorization already used', retryable: false })
      expectNothingReleased(res)
      expect(net.count('/settle')).toBe(0)
      expect(resolveCalls).toHaveLength(0)
    }
    const inFlight: Reply[] = [ok({ isValid: false, invalidReason: 'authorization_in_flight' })]
    for (const verify of inFlight) {
      const { deps, net } = makeDeps({ verify })
      const res = await call(deps, { header: payHeader(paymentFor(1)) })
      expect(res.statusCode).toBe(503)
      expect(res.headers['Retry-After']).toBe('5')
      expect(res.body).toMatchObject({ reason: 'authorization_in_flight', retryable: true })
      expectNothingReleased(res)
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
      expectNothingReleased(res)
      expect(net.count('/settle')).toBe(0)
    }
  })

  it('resolver throwing returns 500 before settle', async () => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') }, { resolveAgent: async () => { throw new Error('boom') } })
    expect((await call(deps, { header: payHeader(paymentFor(0)) })).statusCode).toBe(500)
    expect(net.count('/settle')).toBe(0)
  })

  it('the sequence is verify -> resolve agent -> settle', async () => {
    const order: string[] = []
    const net = scriptedFetch({
      verify: () => { order.push('verify'); return VERIFY_OK.clone() },
      settle: () => { order.push('settle'); return SETTLE_OK('eip155:5042') },
    })
    installFetch(net.fetchImpl)
    const deps: PaidHandlerDeps = {
      resolveAgent: async () => { order.push('resolve'); return { ok: true as const, data: DISCOVERY_OUTPUT_EXAMPLE as never } },
      facilitator: createPaymentFacilitator(),
      env: () => ({ SELLER_ADDRESS: SELLER }),
    }
    expect((await call(deps, { header: payHeader(paymentFor(0)) })).statusCode).toBe(200)
    expect(order).toEqual(['verify', 'resolve', 'settle'])
  })
})

// ── settlement outcomes (the official FacilitatorClient decides; we only release data on a confirmed one) ──

describe('settlement', () => {
  for (const [label, index, network, alias] of [['Arc', 0, 'eip155:5042', 'arc'], ['Base', 1, 'eip155:8453', 'base']] as const) {
    it(`${label}: confirmed settlement returns the data and the established PAYMENT-RESPONSE`, async () => {
      for (const echoed of [network, alias]) {   // the facilitator may echo a short alias
        const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK(echoed) })
        const res = await call(deps, { header: payHeader(paymentFor(index)) })
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual(DISCOVERY_OUTPUT_EXAMPLE)
        const receipt = decodePaymentResponseHeader(res.headers['PAYMENT-RESPONSE'])
        expect(receipt).toMatchObject({ success: true, payer: PAYER, transaction: TX, network })   // CAIP-2, whatever the facilitator echoed
        expect(net.count('/verify')).toBe(1)
        expect(net.count('/settle')).toBe(1)
      }
    })

    it(`${label}: a confirmed receipt rides along; a pending or unknown one releases nothing (503, resend the same credential)`, async () => {
      const confirmed = ok({ success: true, transaction: TX, network, payer: PAYER, receipt: makeReceipt(index, 'confirmed') })
      expect((await call(makeDeps({ verify: VERIFY_OK, settle: confirmed }).deps, { header: payHeader(paymentFor(index)) })).statusCode).toBe(200)
      for (const status of ['pending', 'unknown'] as const) {
        const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: ok({ success: true, transaction: TX, network, payer: PAYER, receipt: makeReceipt(index, status) }) })
        const res = await call(deps, { header: payHeader(paymentFor(index)) })
        expect(res.statusCode).toBe(503)
        expect(res.headers['Retry-After']).toBeDefined()
        expect(res.body).toMatchObject({ error: 'Payment settlement unavailable', retryable: true, safeToReplay: false })
        expectNothingReleased(res)
        expect(net.count('/settle')).toBe(1)
      }
    })

    it(`${label}: an unknown receipt version is fail-closed: no data, no 402, one settle (the SDK never replays an ambiguous result)`, async () => {
      const unknown = ok({ success: true, transaction: TX, network, payer: PAYER, receipt: { ...makeReceipt(index, 'confirmed'), schemaVersion: 99 } })
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: unknown })
      const res = await call(deps, { header: payHeader(paymentFor(index)) })
      expect(res.statusCode).toBe(503)
      expect(res.headers['Retry-After']).toBeDefined()
      expect(res.headers['PAYMENT-REQUIRED']).toBeUndefined()
      expectNothingReleased(res)
      expect((res.body as { reason: string }).reason).toContain('unsupported receipt')
      expect(net.count('/settle')).toBe(1)   // never a second attempt
      expect(net.count('/verify')).toBe(1)
    })

    it(`${label}: a timeout or lost connection at settle is ambiguous: 503, no data, never replayed by the client`, async () => {
      for (const failure of [abortError(), new Error('ECONNRESET')]) {
        const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: failure })
        const res = await call(deps, { header: payHeader(paymentFor(index)) })
        expect(res.statusCode).toBe(503)
        expect(res.body).toMatchObject({ error: 'Payment settlement unavailable', retryable: true, safeToReplay: false })
        expect(res.headers['Retry-After']).toBe('5')
        expectNothingReleased(res)
        expect(net.count('/settle')).toBe(1)
      }
    })
  }

  it('success without a transaction hash releases nothing: 500, retryable:false', async () => {
    for (const body of [{ success: true, network: 'eip155:5042' }, { success: true, transaction: '', network: 'eip155:5042' }]) {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: ok(body) })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(500)
      expect(res.body).toMatchObject({ error: 'Payment settlement failed', reason: 'missing_transaction_hash', retryable: false })
      expectNothingReleased(res)
      expect(net.count('/settle')).toBe(1)
    }
  })

  it('a settlement that fails is NEVER a new 402 challenge: 500 in the SDK format, no data, no retry', async () => {
    const failures: Reply[] = [
      ok({ success: false, errorReason: 'insufficient_funds', network: 'eip155:8453' }),
      ok({ error: 'insufficient_funds', code: 'insufficient_funds' }, 400),
      ok({ success: false, errorReason: 'unexpected_settle_error' }),
    ]
    for (const settle of failures) {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle })
      const res = await call(deps, { header: payHeader(paymentFor(1)) })
      expect(res.statusCode).toBe(500)
      expect(res.headers['PAYMENT-REQUIRED']).toBeUndefined()
      expect(res.body).toMatchObject({ error: 'Payment settlement failed', retryable: false })
      expectNothingReleased(res)
      expect(net.count('/settle')).toBe(1)
    }
  })

  it('a verdict the facilitator itself states (success:false + errorReason) gets a failure PAYMENT-RESPONSE; every other failure gets none', async () => {
    const stated = makeDeps({ verify: VERIFY_OK, settle: ok({ success: false, errorReason: 'insufficient_funds' }) })
    const a = await call(stated.deps, { header: payHeader(paymentFor(1)) })
    expect(a.statusCode).toBe(500)
    expect(decodePaymentResponseHeader(a.headers['PAYMENT-RESPONSE'] as string)).toMatchObject({
      success: false, errorReason: 'insufficient_funds', payer: PAYER, transaction: '', network: 'eip155:8453',
    })
    const noReason = [
      ok({ error: 'insufficient_funds' }, 400),                                              // an HTTP error carries no stated verdict
      ok({ error: 'settlement_unconfirmed', transaction: TX, retryable: false }, 502),       // may be on chain
      ok({ error: 'settlement_in_progress' }, 202),                                          // pending
      ok({ success: true, transaction: TX, receipt: makeReceipt(1, 'pending') }),            // pending receipt
    ]
    for (const settle of noReason) {
      const { deps } = makeDeps({ verify: VERIFY_OK, settle })
      const res = await call(deps, { header: payHeader(paymentFor(1)) })
      expect(res.headers['PAYMENT-RESPONSE']).toBeUndefined()
    }
  })

  it('a success whose attached receipt is not confirmed (verified or rejected) releases nothing', async () => {
    for (const status of ['verified', 'rejected'] as const) {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: ok({ success: true, transaction: TX, network: 'eip155:8453', payer: PAYER, receipt: makeReceipt(1, 'confirmed', { status }) }) })
      const res = await call(deps, { header: payHeader(paymentFor(1)) })
      expect(res.statusCode).toBe(500)
      expect(res.body).toMatchObject({ error: 'Payment settlement failed', reason: 'receipt_not_confirmed', retryable: false })
      expectNothingReleased(res)
      expect(net.count('/settle')).toBe(1)
    }
  })

  it('settlement_unconfirmed keeps the hash and paymentId in a 500 (no Retry-After) and is never retried', async () => {
    const unconfirmed = ok({ error: 'settlement_unconfirmed', transaction: TX, paymentId: PAYMENT_ID, retryable: false }, 502)
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: unconfirmed })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(500)
    expect(res.headers['Retry-After']).toBeUndefined()
    expect(res.body).toMatchObject({ error: 'Payment settlement failed', retryable: false, errorCode: 'settlement_unconfirmed', transaction: TX, paymentId: PAYMENT_ID })
    expectNothingReleased(res)
    expect(net.count('/settle')).toBe(1)
  })

  it('HTTP 202 settlement_in_progress follows the SDK: with a pending receipt 503 + Retry-After, without one the SDK middleware answers 500 (retryable is only set from a receipt); never data, never retried', async () => {
    const withReceipt = makeDeps({ verify: VERIFY_OK, settle: ok({ error: 'settlement_in_progress', receipt: makeReceipt(0, 'pending') }, 202) })
    const a = await call(withReceipt.deps, { header: payHeader(paymentFor(0)) })
    expect(a.statusCode).toBe(503)
    expect(a.headers['Retry-After']).toBe('5')
    expect(a.body).toMatchObject({ error: 'Payment settlement unavailable', retryable: true })
    expectNothingReleased(a)
    expect(withReceipt.net.count('/settle')).toBe(1)

    const bare = makeDeps({ verify: VERIFY_OK, settle: ok({ error: 'settlement_in_progress' }, 202) })
    const b = await call(bare.deps, { header: payHeader(paymentFor(0)) })
    expect(b.statusCode).toBe(500)
    expect(b.body).toMatchObject({ error: 'Payment settlement failed', retryable: false, errorCode: 'settlement_in_progress' })
    expect(b.headers['Retry-After']).toBeUndefined()
    expectNothingReleased(b)
    expect(bare.net.count('/settle')).toBe(1)
  })

  it('authorization already settled / in flight at settle: 409 / 503, never served, never a 402', async () => {
    const used = makeDeps({ verify: VERIFY_OK, settle: ok({ error: 'authorization_already_settled' }, 409) })
    const a = await call(used.deps, { header: payHeader(paymentFor(0)) })
    expect(a.statusCode).toBe(409)
    expect(a.body).toMatchObject({ error: 'Payment authorization already used', retryable: false })
    expectNothingReleased(a)

    const inFlight = makeDeps({ verify: VERIFY_OK, settle: ok({ error: 'authorization_in_flight' }, 409) })
    const b = await call(inFlight.deps, { header: payHeader(paymentFor(1)) })
    expect(b.statusCode).toBe(503)
    expect(b.headers['Retry-After']).toBeDefined()
    expect(b.body).toMatchObject({ reason: 'authorization_in_flight' })
    expectNothingReleased(b)
  })

  it('an unbound replay (a stored answer, no purchase context) is "already used": 409, no data, one settle', async () => {
    const replayed = ok({ success: true, transaction: TX, network: 'eip155:8453', payer: PAYER }, 200, { 'Idempotent-Replayed': 'true' })
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: replayed })
    const res = await call(deps, { header: payHeader(paymentFor(1)) })
    expect(res.statusCode).toBe(409)
    expect(res.statusCode).not.toBe(402)
    expect(res.body).toMatchObject({ error: 'Payment authorization already used' })
    expectNothingReleased(res)
    expect(net.count('/settle')).toBe(1)
  })

  it('the SDK refuseUnboundReplay semantics, mirrored: a replayed pending result without a purchase context is "in flight" (503, details withheld); a replayed failure is unchanged', async () => {
    const replayedPending = ok({ error: 'settlement_in_progress', transaction: TX, paymentId: PAYMENT_ID }, 202, { 'Idempotent-Replayed': 'true' })
    const a = makeDeps({ verify: VERIFY_OK, settle: replayedPending })
    const pending = await call(a.deps, { header: payHeader(paymentFor(1)) })
    expect(pending.statusCode).toBe(503)
    expect(pending.body).toMatchObject({ error: 'Payment authorization in flight', reason: 'authorization_in_flight' })
    expect(JSON.stringify(pending.body)).not.toContain(TX)
    expectNothingReleased(pending)

    const replayedFailure = ok({ success: false, errorReason: 'insufficient_funds' }, 200, { 'Idempotent-Replayed': 'true' })
    const b = makeDeps({ verify: VERIFY_OK, settle: replayedFailure })
    const failed = await call(b.deps, { header: payHeader(paymentFor(1)) })
    expect(failed.statusCode).toBe(500)
    expect(failed.body).toMatchObject({ error: 'Payment settlement failed' })
    expectNothingReleased(failed)
  })

  it('data is released ONLY for success + hash: a table of every other combination releases nothing', async () => {
    const never: Array<[string, Reply]> = [
      ['success:false', ok({ success: false, network: 'eip155:5042' })],
      ['success missing', ok({ transaction: TX, network: 'eip155:5042' })],
      ['empty body', ok({})],
      ['success as string', ok({ success: 'true', transaction: TX })],
      ['non-JSON 200', new Response('<html>oops</html>', { status: 200 })],
      ['HTTP 500', ok({ error: 'internal' }, 500)],
      ['HTTP 403', ok({ code: 3, message: 'Forbidden' }, 403)],
    ]
    for (const [label, settle] of never) {
      const { deps } = makeDeps({ verify: VERIFY_OK, settle })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect({ label, status: res.statusCode, released: 'identity' in (res.body as object) }).toEqual({ label, status: res.statusCode, released: false })
      expect(res.statusCode).not.toBe(200)
      expectNothingReleased(res)
    }
  })

  it('the settlement log carries no signature, header or access token', async () => {
    const { deps } = makeDeps({ verify: VERIFY_OK, settle: ok({ error: 'settlement_unconfirmed', transaction: TX, retryable: false }, 502) })
    await call(deps, { header: payHeader(paymentFor(0)), purchase: '' })
    const logged = errors.join('\n')
    expect(logged).toContain('settlement not confirmed')
    expect(logged).toContain(TX)
    expect(logged).not.toContain('11'.repeat(65))
    expect(logged).not.toMatch(/bearer|api[_-]?key|payment-signature/i)
  })
})

// ── timeouts and the SDK's own safe retries ───────────────────────────────────

describe('timeout and retry settings (official FacilitatorClient options)', () => {
  it('the worst case is bounded inside the 60 s function: 25 s verify + 12 s lookup allowance + 20 s settle = 57 s', () => {
    expect(worstCaseMs(5_000, 1)).toBe(25_000)        // (1 + 1) * 5 s + 1 * 15 s Retry-After
    expect(worstCaseMs(20_000, 0)).toBe(20_000)
    expect(VERIFY_TIMEOUT_MS).toBe(5_000)
    expect(VERIFY_RETRIES).toBe(1)
    expect(SETTLE_TIMEOUT_MS).toBe(20_000)
    expect(SETTLE_RETRIES).toBe(0)
    expect(VERIFY_WORST_MS).toBe(25_000)
    expect(SETTLE_WORST_MS).toBe(20_000)
    expect(FUNCTION_LIMIT_MS).toBe(60_000)
    expect(SETTLE_START_DEADLINE_MS).toBe(FUNCTION_LIMIT_MS - SAFETY_MARGIN_MS - SETTLE_WORST_MS)   // 37 s
    expect(VERIFY_WORST_MS + 12_000 + SETTLE_WORST_MS).toBe(FUNCTION_LIMIT_MS - SAFETY_MARGIN_MS)    // 57 s
    // Settlement can start no later than 37 s in, and then ends by 57 s: inside the 60 s limit with a 3 s margin.
    expect(SETTLE_START_DEADLINE_MS + SETTLE_WORST_MS).toBeLessThan(FUNCTION_LIMIT_MS)
  })

  it('the SDK is given the explicit timeouts (never its 90 s default for Base): 5 s on verify, 20 s on settle', async () => {
    const seen: number[] = []
    const realSet = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => { if (typeof ms === 'number' && ms >= 1000) seen.push(ms); return realSet(fn, ms, ...a) }) as typeof setTimeout
    try {
      for (const index of [0, 1]) {
        const { deps } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK(index ? 'eip155:8453' : 'eip155:5042') })
        expect((await call(deps, { header: payHeader(paymentFor(index)) })).statusCode).toBe(200)
      }
    } finally { globalThis.setTimeout = realSet }
    expect(seen).toEqual([5_000, 20_000, 5_000, 20_000])
    expect(seen).not.toContain(90_000)
  })

  it('verify: the SDK retries a 429 and a pre-execution 503 ONCE, with the identical body and the same key', async () => {
    for (const first of [
      ok({ error: 'rate_limited' }, 429, { 'Retry-After': '0' }),
      ok({ error: 'unavailable', reason: 'holder_unknown' }, 503, { 'Retry-After': '0' }),
    ]) {
      const { deps, net } = makeDeps({ verify: sequence([first, VERIFY_OK]), settle: SETTLE_OK('eip155:5042') })
      const res = await call(deps, { header: payHeader(paymentFor(0)) })
      expect(res.statusCode).toBe(200)
      const verifies = net.calls.filter(c => c.url.endsWith('/verify'))
      expect(verifies).toHaveLength(2)
      expect(JSON.stringify(verifies[1].body)).toBe(JSON.stringify(verifies[0].body))
      expect(verifies[1].headers['idempotency-key']).toBe(verifies[0].headers['idempotency-key'])
      expect(net.calls.at(-1)!.headers['idempotency-key']).toBe(verifies[0].headers['idempotency-key'])   // and settle uses it too
    }
  })

  it('verify: at most VERIFY_RETRIES extra attempt; then 503 + Retry-After (the buyer resends the same credential)', async () => {
    const { deps, net } = makeDeps({ verify: ok({ error: 'rate_limited' }, 429, { 'Retry-After': '0' }), settle: SETTLE_OK('eip155:5042') })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(503)
    expect(net.count('/verify')).toBe(1 + VERIFY_RETRIES)
    expect(net.count('/settle')).toBe(0)
  })

  it('the SDK never retries what may have executed: forward_failed, timeouts and 5xx without a proof are single attempts', async () => {
    const single: Reply[] = [ok({ error: 'x', reason: 'forward_failed' }, 503, { 'Retry-After': '0' }), abortError(), ok({ error: 'bad_gateway' }, 502)]
    for (const verify of single) {
      const { deps, net } = makeDeps({ verify })
      expect((await call(deps, { header: payHeader(paymentFor(0)) })).statusCode).toBe(503)
      expect(net.count('/verify')).toBe(1)
    }
  })

  it(`settle: SETTLE_RETRIES is ${SETTLE_RETRIES}, so even a provably safe 429 is a single attempt answered 503 + Retry-After`, async () => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: ok({ error: 'rate_limited' }, 429, { 'Retry-After': '0' }) })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(503)
    expect(res.headers['Retry-After']).toBe('1')   // the SDK helper never advertises less than one whole second
    expect(res.body).toMatchObject({ error: 'Payment settlement unavailable', retryable: true, safeToReplay: true })
    expect(net.count('/settle')).toBe(1 + SETTLE_RETRIES)
    expectNothingReleased(res)
  })

  it('a Retry-After above the SDK maximum is clamped to 15 s in the answer', async () => {
    const { deps } = makeDeps({ verify: ok({ error: 'unavailable' }, 503, { 'Retry-After': '600' }) })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(503)
    expect(res.headers['Retry-After']).toBe('15')
  })
})

// ── purchase context (X-UVD-Purchase): validated by the SDK, forwarded unchanged ──────────

const PUBLIC_ORIGIN = 'https://www.arcagents.app'
const EMPTY_SHA256 = createHash('sha256').update(new Uint8Array()).digest('hex')
const ACCESS_TOKEN = 'ab'.repeat(32)

/** A buyer's purchase context exactly as the official SDK builds it (sorted keys, base64 JSON). */
function purchaseHeader(opts: { purchaseId?: string; accessToken?: string; query?: Record<string, string>; method?: string; bodySha256?: string; url?: string } = {}) {
  const query = opts.query ?? { network: 'mainnet', agentId: '15' }
  const url = opts.url ?? new URL(`/api/agent/paid?${new URLSearchParams(query).toString()}`, PUBLIC_ORIGIN).toString()
  const ctx = {
    accessToken: opts.accessToken ?? ACCESS_TOKEN,
    bodySha256:  opts.bodySha256 ?? EMPTY_SHA256,
    method:      opts.method ?? 'GET',
    purchaseId:  opts.purchaseId ?? 'order-0001',
    url,
  }
  return { header: Buffer.from(JSON.stringify(ctx)).toString('base64'), url }
}

describe('purchase context (X-UVD-Purchase)', () => {
  for (const [label, index, network] of [['Arc', 0, 'eip155:5042'], ['Base', 1, 'eip155:8453']] as const) {
    it(`${label}: a valid context is forwarded UNCHANGED to verify and settle with the same key; the real URL is the resource`, async () => {
      const { header } = purchaseHeader()
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK(network) })
      const res = await call(deps, { header: payHeader(paymentFor(index)), purchase: header })
      expect(res.statusCode).toBe(200)
      for (const c of net.calls) {
        expect(c.headers['x-uvd-purchase']).toBe(header)
        expect((c.body.resource as { url: string }).url).toBe(REQUEST_URL)
      }
      expect(net.calls[0].headers['idempotency-key']).toBe(net.calls[1].headers['idempotency-key'])
    })
  }

  it('a context for another agent, network, method, body or secret is refused with 400 receipt_context_mismatch before any facilitator call', async () => {
    const good = purchaseHeader()
    const bad = [
      purchaseHeader({ query: { network: 'mainnet', agentId: '16' } }).header,   // another agent
      purchaseHeader({ query: { network: 'testnet', agentId: '15' } }).header,   // another network
      purchaseHeader({ method: 'POST' }).header,
      purchaseHeader({ bodySha256: 'f'.repeat(64) }).header,
      purchaseHeader({ accessToken: 'zz'.repeat(32) }).header,                    // not a 256-bit hex secret
      purchaseHeader({ url: 'https://arcagents.example/api/agent/paid?network=mainnet&agentId=15' }).header,   // another host
      good.header.slice(0, -4),                                                    // truncated base64
      'not base64!',
    ]
    for (const purchase of bad) {
      const { deps, net, resolveCalls } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
      const res = await call(deps, { header: payHeader(paymentFor(0)), purchase })
      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ error: 'receipt_context_mismatch' })
      expect(net.calls).toHaveLength(0)
      expect(resolveCalls).toHaveLength(0)
    }
  })

  it('an empty X-UVD-Purchase counts as no context (the SDK rule)', async () => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
    expect((await call(deps, { header: payHeader(paymentFor(0)), purchase: '' })).statusCode).toBe(200)
    for (const c of net.calls) expect(Object.keys(c.headers)).not.toContain('x-uvd-purchase')
  })

  it('a stored answer reached WITH the buyer\'s context is the original settlement: 200 and the data', async () => {
    const replayed = ok({ success: true, transaction: TX, network: 'eip155:8453', payer: PAYER }, 200, { 'Idempotent-Replayed': 'true' })
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: replayed })
    const res = await call(deps, { header: payHeader(paymentFor(1)), purchase: purchaseHeader().header })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(DISCOVERY_OUTPUT_EXAMPLE)
    expect(decodePaymentResponseHeader(res.headers['PAYMENT-RESPONSE'])).toMatchObject({ success: true, transaction: TX })
    expect(net.count('/settle')).toBe(1)
  })

  it('an authorization admitted for a DIFFERENT purchase (receipt_request_conflict) is never served: 409', async () => {
    for (const where of ['verify', 'settle'] as const) {
      const conflict = ok({ error: 'receipt_request_conflict' }, 409)
      const { deps } = makeDeps(where === 'verify' ? { verify: conflict } : { verify: VERIFY_OK, settle: conflict })
      const res = await call(deps, { header: payHeader(paymentFor(0)), purchase: purchaseHeader().header })
      expect(res.statusCode).toBe(409)
      expect(res.body).toMatchObject({ error: 'Payment authorization already used', retryable: false })
      expectNothingReleased(res)
    }
  })

  it('a payer, network or authorization that does not match the requirement never reaches the facilitator', async () => {
    const wrong = [
      paymentFor(0, { network: 'eip155:8453' }),                 // Arc payment declared on Base
      paymentFor(1, { asset: '0x3600000000000000000000000000000000000000' }),   // Base payment with Arc's USDC
      paymentFor(0, { amount: '1999' }),
    ]
    for (const payment of wrong) {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
      expect((await call(deps, { header: payHeader(payment) })).statusCode).toBe(402)
      expect(net.calls).toHaveLength(0)
    }
  })
})

// ── PAYMENT-RESPONSE contract (the established NFT Data x402 shape) ───────────

describe('PAYMENT-RESPONSE contract', () => {
  for (const [label, index, network] of [['Arc', 0, 'eip155:5042'], ['Base', 1, 'eip155:8453']] as const) {
    it(`${label}: the official paymentResponseHeaders carry success, payer, transaction and network; the private key stays out`, async () => {
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK(network) })
      const res = await call(deps, { header: payHeader(paymentFor(index)) })
      expect(res.statusCode).toBe(200)

      // Both header names the SDK helper sets, byte for byte the same.
      expect(res.headers['PAYMENT-RESPONSE']).toBeDefined()
      expect(res.headers['X-PAYMENT-RESPONSE']).toBe(res.headers['PAYMENT-RESPONSE'])
      const decoded = JSON.parse(Buffer.from(res.headers['PAYMENT-RESPONSE'], 'base64').toString('utf8')) as Record<string, unknown>
      expect(decoded).toMatchObject({ success: true, payer: PAYER, transaction: TX, network })
      expect(decoded.transactionHash).toBe(TX)               // the SDK's own field rides along
      expect(decoded).not.toHaveProperty('idempotencyKey')   // merchant-private
      expect(JSON.stringify(decoded)).not.toContain(net.calls[0].headers['idempotency-key'])
      expect('timestamp' in decoded).toBe(false)             // nothing invented

      // A standard x402 client (@x402/core) reads `transaction`.
      expect(decodePaymentResponseHeader(res.headers['PAYMENT-RESPONSE'])).toMatchObject({ success: true, transaction: TX, network, payer: PAYER })
    })
  }

  it('CORS and cache headers are merged, not replaced; the success response is not cacheable', async () => {
    const { deps } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    const exposed = res.headers['Access-Control-Expose-Headers'].split(',').map(h => h.trim())
    expect(exposed).toEqual(expect.arrayContaining(['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'X-PAYMENT-RESPONSE', 'Retry-After']))
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.headers['Cache-Control']).toContain('no-store')
  })

  it('an oversized SDK result cannot lose the paid data: the helper refuses the header, so the established fields alone are sent', async () => {
    // `paymentId` is passed through by the SDK unvalidated; 40 kB of it overflows the helper's 32 kB header limit.
    const { deps } = makeDeps({ verify: VERIFY_OK, settle: ok({ success: true, transaction: TX, network: 'eip155:5042', payer: PAYER, paymentId: 'p'.repeat(40_000) }) })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('identity')
    const header = res.headers['PAYMENT-RESPONSE']
    expect(header.length).toBeLessThanOrEqual(32_768)
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<string, unknown>
    expect(decoded).toEqual({ success: true, payer: PAYER, transaction: TX, network: 'eip155:5042' })
  })
})

// ── the time guard in front of settlement ─────────────────────────────────────

describe('time guard', () => {
  it('settlement is not started when it could no longer finish inside the function limit: 503, nothing charged', async () => {
    let t = 0
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') }, {
      now: () => t,
      resolveAgent: async () => { t = SETTLE_START_DEADLINE_MS + 1; return { ok: true as const, data: DISCOVERY_OUTPUT_EXAMPLE as never } },
    })
    const res = await call(deps, { header: payHeader(paymentFor(0)) })
    expect(res.statusCode).toBe(503)
    expect(res.headers['Retry-After']).toBeDefined()
    expect(res.body).toMatchObject({ error: expect.stringContaining('You were not charged'), reason: 'time_budget_exhausted', retryable: true })
    expectNothingReleased(res)
    expect(net.count('/verify')).toBe(1)
    expect(net.count('/settle')).toBe(0)
  })

  it('exactly at the deadline it still settles (the bound is inclusive)', async () => {
    let t = 0
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') }, {
      now: () => t,
      resolveAgent: async () => { t = SETTLE_START_DEADLINE_MS; return { ok: true as const, data: DISCOVERY_OUTPUT_EXAMPLE as never } },
    })
    expect((await call(deps, { header: payHeader(paymentFor(0)) })).statusCode).toBe(200)
    expect(net.count('/settle')).toBe(1)
  })
})

// ── query validation ──────────────────────────────────────────────────────────

describe('query validation', () => {
  const callWithQuery = async (query: Record<string, unknown>) => {
    const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: SETTLE_OK('eip155:5042') })
    const res = fakeRes()
    await createPaidHandler(deps)({ method: 'GET', url: '/api/agent/paid?network=mainnet&agentId=15', headers: { 'payment-signature': payHeader(paymentFor(0)) }, query } as never, res as never)
    return { res, net }
  }

  it('a repeated network or agentId parameter is a clean 400 (no exception, no facilitator call)', async () => {
    for (const query of [
      { network: ['mainnet', 'mainnet'], agentId: '15' },
      { network: 'mainnet', agentId: ['15', '16'] },
      { network: ['mainnet'], agentId: ['15'] },
    ]) {
      const { res, net } = await callWithQuery(query)
      expect(res.statusCode).toBe(400)
      expect((res.body as { error: string }).error).toBe('bad_request')
      expect(net.calls).toHaveLength(0)
    }
  })

  it('single parameters still work', async () => {
    expect((await callWithQuery({ network: 'mainnet', agentId: '15' })).res.statusCode).toBe(200)
  })

  it('CORS allows X-UVD-Purchase and exposes PAYMENT-REQUIRED, PAYMENT-RESPONSE and Retry-After', async () => {
    const res = fakeRes()
    await createPaidHandler(makeDeps({}).deps)({ method: 'OPTIONS', url: '/api/agent/paid', headers: {}, query: {} } as never, res as never)
    expect(res.statusCode).toBe(204)
    expect(res.headers['Access-Control-Allow-Headers']).toContain('X-UVD-Purchase')
    const exposed = res.headers['Access-Control-Expose-Headers'].split(',').map(h => h.trim())
    expect(exposed).toEqual(expect.arrayContaining(['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'Retry-After']))
  })
})

// ── alignment with the official Ultravioleta DAO SDK (uvd-x402-sdk 2.114.0) ───

describe('official SDK alignment', () => {
  const read = (rel: string) => readFileSync(resolve(import.meta.dir, '../../..', rel), 'utf8')

  for (const [label, name, index] of [['Arc', 'arc', 0], ['Base', 'base', 1]] as const) {
    it(`${label}: network id, USDC address, decimals, EIP-712 domain and facilitator match the SDK's own chain registry`, () => {
      const chain = getChainByName(name) as unknown as {
        chainId: number; usdc: { address: string; decimals: number; name: string; version: string }; x402: { facilitatorUrl: string; enabled: boolean }
      }
      const req = buildPaymentRequirements(SELLER)[index]
      expect(chainToCAIP2(name)).toBe(req.network)
      expect(req.network).toBe(`eip155:${chain.chainId}`)
      expect(req.asset.toLowerCase()).toBe(chain.usdc.address.toLowerCase())
      expect(req.extra).toMatchObject({ name: chain.usdc.name, version: chain.usdc.version })
      expect(req.amount).toBe('2000')                       // $0.002 at the SDK's 6 USDC decimals
      expect(chain.usdc.decimals).toBe(6)
      expect(chain.x402.enabled).toBe(true)
      expect(chain.x402.facilitatorUrl).toBe('https://facilitator.ultravioletadao.xyz')
    })
  }

  it('the SDK is a pinned dependency used through FacilitatorClient; no custom transport, retry loop or stack key remains', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['uvd-x402-sdk']).toBe('2.114.0')
    const code = (read('api/_lib/x402-facilitator.ts') + read('api/agent/paid.ts'))
      .split('\n').filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line)).join('\n')   // comments may explain what is NOT used
    expect(code).toMatch(/new FacilitatorClient\(/)
    expect(code).toMatch(/\.verify\(/)
    expect(code).toMatch(/\.settle\(/)
    expect(code).not.toMatch(/['"`]X-UVD-Stack-Key['"`]|stackKey\s*[:=]|createPaymentMiddleware\(|createFetchPaywall\(|\bMPP\b/)
    expect(code).not.toMatch(/\bfetch\(|AbortController|setTimeout|ReplayStore|authorizationKey|DEFINITE_REJECTIONS/)
    expect(read('api/_lib/x402-facilitator.ts').split('\n').length).toBeLessThan(160)   // an adapter, not an implementation
  })
})

// ── deployment configuration ──────────────────────────────────────────────────

describe('deployment configuration', () => {
  const root = new URL('../../../', import.meta.url).pathname

  it('vercel.json gives the paid endpoint maxDuration 60, the limit the timeout calculation is built on, and keeps the rewrites', () => {
    const cfg = JSON.parse(readFileSync(`${root}vercel.json`, 'utf8')) as { functions?: Record<string, { maxDuration?: number }>; rewrites: Array<{ source: string; destination: string }> }
    expect(cfg.functions?.['api/agent/paid.ts']?.maxDuration).toBe(60)
    expect(cfg.functions!['api/agent/paid.ts'].maxDuration! * 1000).toBe(FUNCTION_LIMIT_MS)
    expect(cfg.rewrites.map(r => r.source)).toEqual(['/api/(.*)', '/openapi.json', '/(.*)'])
    // The function key must be a real file, or Vercel rejects the deployment.
    expect(existsSync(`${root}api/agent/paid.ts`)).toBe(true)
  })
})

// ── interoperability with the official x402 client ────────────────────────────

describe('official x402 client interoperability (throwaway unfunded key, nothing is sent anywhere)', () => {
  for (const [label, index] of [['Arc', 0], ['Base', 1]] as const) {
    it(`${label}: a payload created by the official client is accepted and signed with the right EIP-712 domain`, async () => {
      const buyer = privateKeyToAccount(generatePrivateKey())
      const network = PAYMENT_NETWORKS[index]
      const { deps, net } = makeDeps({ verify: VERIFY_OK, settle: () => ok({ success: true, transaction: TX, network: network.caip2, payer: buyer.address }) })

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

// ── public documentation, canonical URLs and discovery ────────────────────────────────────────

describe('public documentation and discovery', () => {
  const root = new URL('../../../', import.meta.url).pathname
  const read = (rel: string) => readFileSync(`${root}${rel}`, 'utf8')
  const ULTRAVIOLETA_BAZAAR = 'https://facilitator.ultravioletadao.xyz/bazaar?q=www.arcagents.app'
  const X402_BAZAAR = 'https://x402-bazaar.com/resources/6af36d3129802b0f3634caf5'
  const served = () => { const res = fakeRes(); openApiHandler({ method: 'GET' } as never, res as never); return res.body as {
    info: { contact: { url: string }; ['x-guidance']: string }; externalDocs: { url: string }; servers: Array<{ url: string }>
    paths: Record<string, { get: { ['x-payment-info']: { price: { amount: string; currency: string }; protocols: unknown[] } } }>
  } }

  const SEO = 'Explore ERC-8004 agents on Arc Mainnet and Testnet. Search agent IDs, inspect owners, wallets, metadata, reputation and validation data.'
  const PAID = 'Retrieve ERC-8004 agent identity and registration data from Arc Mainnet through x402 v2 payments.'
  const OWNED_FILES = ['index.html', 'README.md', 'AGENTS.md', 'api/openapi.json.ts', 'api/agent.ts', 'api/_lib/resolve.ts', 'api/_lib/x402-config.ts',
    'public/sitemap.xml', 'public/robots.txt', 'public/site.webmanifest', 'src/components/AgentDashboard.tsx']

  it('the website metadata uses the canonical https://www.arcagents.app and sitemap/robots agree', () => {
    const html = read('index.html')
    expect(html).toContain('<link rel="canonical" href="https://www.arcagents.app/" />')
    expect(html).toContain('<meta property="og:url" content="https://www.arcagents.app/" />')
    expect(html).toContain('<meta property="og:image" content="https://www.arcagents.app/og-image.png" />')
    expect(html).toContain('<meta name="twitter:image" content="https://www.arcagents.app/og-image.png" />')
    expect(html).toContain('"@id": "https://www.arcagents.app/#website"')
    expect(html).toContain('"@id": "https://www.arcagents.app/#app"')
    expect(read('public/sitemap.xml')).toContain('<loc>https://www.arcagents.app/</loc>')
    expect(read('public/robots.txt')).toContain('Sitemap: https://www.arcagents.app/sitemap.xml')
    expect(read('src/components/AgentDashboard.tsx')).toContain("const SHARE_ORIGIN = 'https://www.arcagents.app'")
  })

  it('no project-owned URL uses the bare arcagents.app domain (only the exact external Ultravioleta Bazaar query keeps www in a query)', () => {
    for (const file of OWNED_FILES) {
      expect({ file, bare: read(file).match(/https?:\/\/arcagents\.app/g) }).toEqual({ file, bare: null })
    }
    expect(read('README.md')).toContain(ULTRAVIOLETA_BAZAAR)
  })

  it('the website title is unchanged and the SEO description is identical in meta, Open Graph, Twitter, JSON-LD and the manifest', () => {
    const html = read('index.html')
    expect(html).toContain('<title>Arc ERC-8004 Explorer</title>')
    expect(html).toContain(`<meta name="description" content="${SEO}" />`)
    expect(html).toContain(`<meta property="og:description" content="${SEO}" />`)
    expect(html).toContain(`<meta name="twitter:description" content="${SEO}" />`)
    expect(html.split(`"description": "${SEO}"`).length - 1).toBe(2)   // WebSite + WebApplication
    expect((JSON.parse(read('public/site.webmanifest')) as { description: string }).description).toBe(SEO)
    // the website covers exactly the two networks it implements
    expect(html).not.toMatch(/Ethereum|Base Mainnet|Sepolia|Polygon/)
  })

  it('the paid endpoint is described as Arc Mainnet only: 402 resource, Bazaar schema, OpenAPI operation, README', async () => {
    const challenge = decodePaymentRequiredHeader((await call(makeDeps({}).deps)).headers['PAYMENT-REQUIRED'])
    expect(challenge.resource.description).toBe(PAID)
    const bazaar = (challenge.extensions as { bazaar: { schema: { properties: { input: { properties: { queryParams: { properties: { network: { enum: string[] } } } } }; output: { properties: { example: unknown } } } } } }).bazaar
    expect(JSON.stringify(bazaar.schema)).not.toContain('testnet')
    const op = (served() as unknown as { paths: Record<string, { get: { summary: string; description: string } }> }).paths['/api/agent/paid'].get
    expect(op.summary).toBe('Retrieve ERC-8004 agent data from Arc Mainnet (paid, 0.002 USDC)')
    expect(op.description.startsWith(PAID)).toBe(true)
    expect(read('README.md')).toContain(PAID)
    expect(read('README.md')).toMatch(/does not provide Arc Testnet data/)
    // the resource that is actually paid for is never described as a Testnet source
    for (const text of [challenge.resource.description, op.summary, op.description]) expect(text).not.toMatch(/Testnet data|and Testnet\.|Arc Testnet support/i)
  })

  it('the payment resource keeps its published www URL, which is also the first OpenAPI server and the Bazaar listing key', () => {
    const spec = served()
    expect(spec.servers.map(s => s.url)).toEqual(['https://www.arcagents.app'])
    expect(`${spec.servers[0].url}/api/agent/paid`).toBe('https://www.arcagents.app/api/agent/paid')
    expect(spec.info.contact.url).toBe('https://www.arcagents.app')
    expect(spec.externalDocs.url).toBe('https://www.arcagents.app')
  })

  it('OpenAPI x-payment-info matches the 402 challenge: price 0.002 USD, x402 only, the same resource URL', async () => {
    const challenge = decodePaymentRequiredHeader((await call(makeDeps({}).deps)).headers['PAYMENT-REQUIRED'])
    const info = served().paths['/api/agent/paid'].get['x-payment-info']
    expect(Number(info.price.amount)).toBe(Number(challenge.accepts[0].amount) / 1_000_000)
    expect(info.price.currency).toBe('USD')
    expect(info.protocols).toEqual([{ x402: {} }])
    expect(challenge.resource.url).toBe(`${served().servers[0].url}/api/agent/paid`)
    expect(challenge.accepts.map(a => a.amount)).toEqual(['2000', '2000'])
  })

  it('Bazaar is registered in the payment server and the 402 carries the Bazaar resource metadata', async () => {
    expect(readFileSync(`${root}api/agent/paid.ts`, 'utf8')).toMatch(/registerExtension\(bazaarResourceServerExtension\)/)
    const challenge = decodePaymentRequiredHeader((await call(makeDeps({}).deps)).headers['PAYMENT-REQUIRED'])
    expect(Object.keys(challenge.extensions ?? {})).toEqual(['bazaar'])
    const bazaar = (challenge.extensions as { bazaar: { info: { input: { method: string; queryParams: unknown }; output: { example: unknown } } } }).bazaar
    expect(bazaar.info.input.method).toBe('GET')
    expect(bazaar.info.input.queryParams).toEqual({ network: 'mainnet', agentId: 15 })
    expect(bazaar.info.output.example).toBeDefined()
    expect(challenge.resource).toMatchObject({ serviceName: 'Arc ERC-8004 Explorer', mimeType: 'application/json' })
  })

  it('README, AGENTS.md and OpenAPI link the two Bazaar discovery pages exactly; the README Discovery section stays free of Poncho', () => {
    const spec = JSON.stringify(served())
    for (const text of [read('README.md'), read('AGENTS.md'), spec]) {
      expect(text).toContain(ULTRAVIOLETA_BAZAAR)
      expect(text).toContain(X402_BAZAAR)
    }
    const readme = read('README.md')
    const discovery = readme.slice(readme.indexOf('\n## Discovery\n'), readme.indexOf('\n## Tech Stack\n'))
    expect(discovery).toContain(ULTRAVIOLETA_BAZAAR)
    expect(discovery).toContain(X402_BAZAAR)
    expect(discovery).not.toMatch(/Poncho/)
  })

  it('README.md and AGENTS.md contain no Poncho references', () => {
    for (const file of ['README.md', 'AGENTS.md']) expect(read(file)).not.toMatch(/poncho/i)
  })

  it('does not claim a completed live payment or Bazaar ranking it cannot know', () => {
    const readme = read('README.md')
    expect(readme).toMatch(/pending production verification/i)
    expect(readme).toMatch(/does not prove that a payment/i)
    expect(readme).not.toMatch(/runtime-verified through|verified live settlement|100\/100 for the current/i)
  })

  it('no active public file names Circle as the payment facilitator; the independent Circle badge and readiness link are untouched', () => {
    for (const file of ['README.md', 'AGENTS.md', 'api/openapi.json.ts', 'src/components/AgentDashboard.tsx', 'index.html', 'openapi.json.ts']) {
      const text = read(file)
      expect(text).not.toMatch(/Circle Facilitator|Circle Gateway Nanopayments|Circle facilitator/)
      expect(text).not.toMatch(/gateway-api\.circle\.com|GatewayWalletBatched|0\.01 USDC/)
    }
    const dashboard = read('src/components/AgentDashboard.tsx')
    expect(dashboard).toContain('https://agents.circle.com/sell/score?url=www.arcagents.app')
    expect(dashboard).toContain('Accepts Agent Payments · Verified by Circle')
    expect(read('README.md')).toContain('[Check the current Circle agent-readiness score](https://agents.circle.com/sell/score?url=www.arcagents.app)')
    expect(dashboard).toContain('Ultravioleta DAO facilitator verification and settlement')
  })

  it('the Gateway-era audit report is marked historical and the stale root OpenAPI copy only re-exports the served spec', () => {
    expect(read('docs/x402-audit-report.md').startsWith('> **Historical document')).toBe(true)
    const rootSpec = read('openapi.json.ts')
    expect(rootSpec).toContain("export { default } from './api/openapi.json.ts'")
    expect(rootSpec).not.toContain('Gateway Nanopayments')
  })
})

// ── repository guards: the migration is complete and nothing extra crept in ───

describe('repository guards', () => {
  const root = resolve(import.meta.dir, '../../..')
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
  const payment = ['api/agent/paid.ts', 'api/_lib/x402-facilitator.ts', 'api/_lib/x402-config.ts']

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

  it('reads only SELLER_ADDRESS from the environment (no facilitator API key)', () => {
    const vars = new Set(payment.flatMap(f => [...read(f).matchAll(/env\.([A-Z0-9_]+)/g)].map(m => m[1])))
    expect([...vars].sort()).toEqual(['SELLER_ADDRESS'])
  })

  it('the migration from Circle is complete: no Circle facilitator code, URL, key or Authorization header', () => {
    expect(existsSyncSafe(resolve(root, 'api/_lib/circle-facilitator.ts'))).toBe(false)
    for (const file of [...payment, 'api/openapi.json.ts']) {
      const src = read(file)
      expect(src).not.toMatch(/circle/i)
      expect(src).not.toContain('CIRCLE_FACILITATOR_API_KEY')
      expect(src).not.toMatch(/['"`]Authorization['"`]|Authorization\s*:|Bearer \$\{/)
    }
    expect(read('api/_lib/x402-config.ts')).toContain("FACILITATOR_BASE_URL = 'https://facilitator.ultravioletadao.xyz'")
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
