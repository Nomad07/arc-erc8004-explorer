// arc-studio-allow-onchain-literal
/**
 * Payment and discovery configuration for GET /api/agent/paid.
 * Single source of truth shared by the handler, the OpenAPI document, the tests
 * and scripts/smoke-x402.ts.
 *
 * Payments: x402 v2 `exact` (EIP-3009) verified and settled by the Ultravioleta DAO
 * facilitator (https://facilitator.ultravioletadao.xyz).
 * Networks: Arc Mainnet and Base Mainnet only. The USDC addresses below match the
 * facilitator's published GET /supported response (exact, x402 v2, eip155:5042 and
 * eip155:8453). The EIP-712 domain values are supplied by this seller in `extra`
 * (the facilitator's /supported lists tokens but not the signing domain).
 *
 * The addresses in this file are documented constants and a real registry
 * response used as a discovery example, not secrets or wallet configuration.
 */

export const RESOURCE_URL = 'https://www.arcagents.app/api/agent/paid'

// ── Service metadata (carried in the 402 `resource` object / Bazaar catalog) ──
export const SERVICE_NAME = 'Arc ERC-8004 Explorer'
export const SERVICE_DESCRIPTION =
  'Retrieve ERC-8004 agent identity and registration data from Arc Mainnet through x402 v2 payments.'
export const SERVICE_TAGS = ['arc', 'erc-8004', 'agents', 'blockchain', 'identity']
// Existing public project icon (public/icon-512.png).
export const SERVICE_ICON_URL = 'https://www.arcagents.app/icon-512.png'

// ── Price ─────────────────────────────────────────────────────────────────────
export const PRICE_USD = '0.002'
export const PRICE_ATOMIC = '2000' // 0.002 USDC at 6 decimals
export const MAX_TIMEOUT_SECONDS = 60

// ── Facilitator: Ultravioleta DAO (no account, no API key) ───────────────────
export const FACILITATOR_BASE_URL = 'https://facilitator.ultravioletadao.xyz'

export interface PaymentNetwork {
  key:           'arc' | 'base'
  name:          string
  caip2:         string
  asset:         string  // USDC contract
  domainName:    string  // EIP-712 domain name of the USDC contract on this chain
  domainVersion: string  // EIP-712 domain version
}

// The two networks differ in their EIP-712 domain name; do not share one value.
export const PAYMENT_NETWORKS: readonly PaymentNetwork[] = [
  {
    key:           'arc',
    name:          'Arc Mainnet',
    caip2:         'eip155:5042',
    asset:         '0x3600000000000000000000000000000000000000',
    domainName:    'USDC',
    domainVersion: '2',
  },
  {
    key:           'base',
    name:          'Base Mainnet',
    caip2:         'eip155:8453',
    asset:         '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    domainName:    'USD Coin',
    domainVersion: '2',
  },
]

// ── Bazaar discovery: input ───────────────────────────────────────────────────
export const DISCOVERY_INPUT_EXAMPLE = { network: 'mainnet', agentId: 15 }

export const DISCOVERY_INPUT_SCHEMA = {
  properties: {
    network: {
      type: 'string',
      enum: ['mainnet'],
      description: "ERC-8004 data network. Must be 'mainnet': the paid endpoint always resolves from Arc Mainnet, whichever chain the payment is made on.",
    },
    agentId: {
      type: 'integer',
      minimum: 1,
      description: 'ERC-8004 agent token ID (positive integer) registered on Arc Mainnet.',
    },
  },
  required: ['network', 'agentId'],
  additionalProperties: false,
} as const

// ── Bazaar discovery: output (mirrors AgentResponse in api/_lib/types.ts) ─────
const NULLABLE_STRING = { type: ['string', 'null'] } as const

export const AGENT_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['agentId', 'network', 'chainId', 'identity', 'metadata', 'metadataError', 'reputation', 'validation', 'links', 'fetchedAt'],
  properties: {
    agentId:  { type: 'integer', description: 'ERC-8004 token ID.' },
    network:  { type: 'string', enum: ['mainnet'], description: "ERC-8004 data network: always 'mainnet' (Arc Mainnet) on this endpoint." },
    chainId:  { type: 'integer', description: 'EVM chain ID the data was read from (5042 for Arc Mainnet).' },
    identity: {
      type: 'object',
      required: ['owner', 'agentWallet', 'metadataUri', 'registries'],
      properties: {
        owner:       { type: 'string', description: 'Token owner address.' },
        agentWallet: { type: 'string', description: 'Designated agent wallet address.' },
        metadataUri: { type: 'string', description: 'Raw IPFS or HTTPS metadata URI.' },
        registries: {
          type: 'object',
          required: ['identity', 'reputation', 'validation'],
          properties: {
            identity:   { type: 'string' },
            reputation: { type: 'string' },
            validation: { type: ['string', 'null'], description: 'Null where no validation registry is deployed.' },
          },
        },
      },
    },
    metadata: {
      type: ['object', 'null'],
      description: 'Parsed agent metadata JSON. Null if the metadata fetch failed. Extra keys from the agent file are passed through.',
      properties: {
        name:        NULLABLE_STRING,
        description: NULLABLE_STRING,
        services:    { type: ['array', 'null'], items: { type: 'object' } },
        active:      { type: ['boolean', 'null'] },
        x402Support: { type: ['boolean', 'null'] },
      },
    },
    metadataError: { type: ['string', 'null'], description: 'Error code if the metadata fetch failed; null on success.' },
    reputation: {
      type: 'object',
      required: ['clientCount', 'feedbackCount', 'aggregateScore', 'clients', 'feedback'],
      properties: {
        clientCount:    { type: 'integer' },
        feedbackCount:  { type: 'integer' },
        aggregateScore: { type: ['string', 'null'], description: 'Signed decimal score; null when there is no feedback.' },
        clients:        { type: 'array', items: { type: 'string' } },
        feedback: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              client:        { type: 'string' },
              feedbackIndex: { type: 'integer' },
              value:         { type: 'string', description: 'Formatted signed decimal score.' },
              tag1:          NULLABLE_STRING,
              tag2:          NULLABLE_STRING,
              isRevoked:     { type: 'boolean' },
            },
          },
        },
      },
    },
    validation: {
      type: 'object',
      required: ['available', 'reason', 'requestCount', 'requests'],
      properties: {
        available:    { type: 'boolean' },
        reason:       { type: ['string', 'null'] },
        requestCount: { type: ['integer', 'null'] },
        requests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              requestHash:      { type: 'string' },
              validatorAddress: { type: 'string' },
              response:         { type: 'integer' },
              responseHash:     { type: 'string' },
              hasResponse:      { type: 'boolean' },
              tag:              NULLABLE_STRING,
              lastUpdate:       { type: 'integer', description: 'Unix timestamp.' },
              lastUpdateIso:    { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    links: {
      type: 'object',
      required: ['explorer', 'agentOnExplorer'],
      properties: {
        explorer:        { type: 'string' },
        agentOnExplorer: { type: 'string' },
      },
    },
    fetchedAt: { type: 'string', format: 'date-time' },
  },
} as const

// A real response from this endpoint for agent #15 on Arc Mainnet (read-only registry data).
export const DISCOVERY_OUTPUT_EXAMPLE = {
  agentId: 15,
  network: 'mainnet',
  chainId: 5042,
  identity: {
    owner: '0x4cd95FD3F59E803e4Bc6b3E7D1E6Fc8f23859aB7',
    agentWallet: '0x4cd95FD3F59E803e4Bc6b3E7D1E6Fc8f23859aB7',
    metadataUri: 'ipfs://bafkreie4vt7xo2zhnprnamcrkghkg4uhkms7knqz5doafivkk7ramnvexa',
    registries: {
      identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
      validation: null,
    },
  },
  metadata: {
    name: 'Arc Agent ID',
    description: 'An experimental AI agent identity toolkit built with Python and ERC-8004 on Arc Mainnet.',
    services: [
      { name: 'Arc Agent ID Toolkit', endpoint: 'https://github.com/Nomad07/arc-agent-id' },
    ],
  },
  metadataError: null,
  reputation: { clientCount: 0, feedbackCount: 0, aggregateScore: null, clients: [], feedback: [] },
  validation: {
    available: false,
    reason: 'Validation registry not deployed on this network',
    requestCount: null,
    requests: [],
  },
  links: {
    explorer: 'https://explorer.arc.io',
    agentOnExplorer: 'https://www.arcagents.app/agent/15?network=mainnet',
  },
  fetchedAt: '2026-11-07T20:16:40.511Z',
} as const
