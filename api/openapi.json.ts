/**
 * GET /api/openapi.json
 * Returns the OpenAPI 3.1 specification for the Arc ERC-8004 Explorer API.
 * arc-studio-allow-onchain-literal (example values in OpenAPI spec are documented fixtures)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const spec = {
  openapi: '3.1.0',
  info: {
    title:       'Arc ERC-8004 Explorer API',
    version:     '1.1.0',
    description: 'Read-only public API for resolving ERC-8004 agent identities on Arc Mainnet and Arc Testnet. No authentication required for the free endpoint. No write operations.',
    contact: { url: 'https://arcagents.app', email: 'hi@arcagents.app' },
    'x-agent-consumable': true,
    'x-guidance': [
      'ARC AGENTS API — guidance for AI agents',
      '',
      'SERVICE: Resolve ERC-8004 on-chain agent identities registered on the Arc blockchain.',
      'Returns: owner address, agent wallet, IPFS metadata (name, description, services), reputation score and client feedback, and validation status.',
      '',
      'FREE ENDPOINT — GET /api/agent',
      '  Required: network (mainnet | testnet), agentId (positive integer)',
      '  No payment. No authentication. Returns full AgentResponse.',
      '  Use this endpoint for Testnet lookups and for exploratory/free Mainnet lookups.',
      '',
      'PAID ENDPOINT — GET /api/agent/paid',
      '  Required: network=mainnet, agentId (positive integer)',
      '  Cost: 0.01 USDC per successful request',
      '  Payment: x402 Version 2, Circle Gateway Nanopayments, Arc Mainnet (eip155:5042)',
      '  Asset: USDC at 0x3600000000000000000000000000000000000000 (6 decimals; amount = 10000)',
      '  Flow: 1) Send GET without X-PAYMENT → receive 402 with PAYMENT-REQUIRED header.',
      '         2) Decode PAYMENT-REQUIRED (base64 JSON) to read payment requirements.',
      '         3) Sign a Gateway EIP-3009 authorization for 10000 USDC units.',
      '         4) Base64-encode the signed payload → X-PAYMENT header.',
      '         5) Resend GET with X-PAYMENT → receive 200 AgentResponse on success.',
      '  Returns: identical structure to the free endpoint.',
      '  Mainnet only: network=testnet returns 400.',
      '',
      'WHEN TO CALL:',
      '  - Call /api/agent to discover what an ERC-8004 agent does before interacting with it.',
      '  - Call /api/agent/paid when a workflow requires verified agent identity data and the agent can pay per call.',
      '  - Both endpoints are read-only and safe to call without fear of side effects.',
      '',
      'AGENT IDs: on Arc Mainnet, confirmed agents include #1, #8, #14, #15. On Testnet: #1, #2, #98, #876978, #876991.',
      'A 404 means the agent ID is not minted on that network.',
    ].join('\n'),
  },
  externalDocs: {
    description: 'Arc ERC-8004 Explorer',
    url:         'https://arcagents.app',
  },
  servers: [
    { url: 'https://arcagents.app', description: 'Production' },
    { url: 'https://www.arcagents.app', description: 'Production (www)' },
  ],
  paths: {
    '/api/agent': {
      get: {
        operationId: 'getAgent',
        summary:     'Resolve an ERC-8004 agent by ID',
        description: 'Returns identity, metadata, reputation, and validation data for the specified ERC-8004 agent on the given Arc network. All data is fetched live from the onchain registries. Read-only.',
        parameters: [
          {
            name: 'network', in: 'query', required: true,
            description: "Target network: 'mainnet' (Arc Mainnet, chainId 5042) or 'testnet' (Arc Testnet, chainId 5042002).",
            schema: { type: 'string', enum: ['mainnet', 'testnet'] },
            example: 'mainnet',
          },
          {
            name: 'agentId', in: 'query', required: true,
            description: 'ERC-8004 agent token ID (positive integer).',
            schema: { type: 'integer', minimum: 1 },
            example: 15,
          },
        ],
        responses: {
          '200': {
            description: 'Agent resolved successfully.',
            headers: {
              'Cache-Control':                { description: 'CDN cache — 30s for successful responses.', schema: { type: 'string' } },
              'Access-Control-Allow-Origin':  { description: 'CORS header. Always *.', schema: { type: 'string' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid or missing query parameters.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          '404': {
            description: 'Agent ID not found on the specified network.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          '503': {
            description: 'RPC call failed.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          '500': {
            description: 'Unexpected server error.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/agent/paid': {
      get: {
        operationId: 'getAgentPaid',
        summary:     'Resolve an ERC-8004 agent by ID (paid, 0.01 USDC)',
        description: 'Returns the same agent data as /api/agent but requires a Circle Gateway x402 payment of 0.01 USDC on Arc Mainnet. Only network=mainnet is accepted. Requires an X-PAYMENT header containing a base64-encoded x402 Version 2 payment payload.',
        'x-payment-info': {
          price: {
            mode:     'fixed',
            currency: 'USDC',
            amount:   '0.010000',
          },
          protocols: [
            { x402: {} },
          ],
        },
        parameters: [
          {
            name: 'network', in: 'query', required: true,
            description: "Must be 'mainnet'. The paid endpoint does not support Testnet. Use /api/agent for free Testnet lookups.",
            schema: { type: 'string', enum: ['mainnet'] },
            example: 'mainnet',
          },
          {
            name: 'agentId', in: 'query', required: true,
            description: 'ERC-8004 agent token ID (positive integer).',
            schema: { type: 'integer', minimum: 1 },
            example: 15,
          },
        ],
        requestBody: undefined,
        responses: {
          '200': {
            description: 'Agent resolved successfully. Payment was settled.',
            headers: {
              'Access-Control-Allow-Origin': { description: 'CORS header. Always *.', schema: { type: 'string' } },
              'Cache-Control':               { description: 'no-store — paid responses are never cached.', schema: { type: 'string' } },
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AgentResponse' } },
            },
          },
          '400': {
            description: 'Invalid or missing query parameters, or network=testnet was requested.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          '402': {
            description: 'Payment required or payment failed. The PAYMENT-REQUIRED header contains a base64-encoded x402 Version 2 payment requirements object.',
            headers: {
              'PAYMENT-REQUIRED': {
                description: 'Base64-encoded JSON payment requirements (x402 Version 2). Decode, sign a GatewayWalletBatched EIP-3009 authorization for 10000 USDC units on eip155:5042, base64-encode the payload, and resend as the X-PAYMENT header.',
                schema: { type: 'string', format: 'byte' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentRequiredResponse' },
                example: {
                  x402Version: 2,
                  resource: {
                    url:         'https://www.arcagents.app/api/agent/paid',
                    description: 'Resolve an ERC-8004 agent identity on Arc. Returns identity, metadata, reputation, and validation data.',
                    mimeType:    'application/json',
                  },
                  accepts: [
                    {
                      scheme:            'exact',
                      network:           'eip155:5042',
                      asset:             '0x3600000000000000000000000000000000000000',
                      amount:            '10000',
                      payTo:             '0x<SELLER_ADDRESS>',
                      maxTimeoutSeconds: 604900,
                      extra: {
                        name:              'GatewayWalletBatched',
                        version:           '1',
                        verifyingContract: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
                      },
                    },
                  ],
                },
              },
            },
          },
          '404': {
            description: 'Agent ID not found on Arc Mainnet.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          '500': {
            description: 'Unexpected server error.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          '503': {
            description: 'RPC call failed.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/openapi.json': {
      get: {
        operationId: 'getOpenApi',
        summary:     'OpenAPI specification',
        description: 'Returns this OpenAPI 3.1 document.',
        responses: {
          '200': { description: 'OpenAPI document.', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      AgentResponse: {
        type: 'object',
        required: ['agentId', 'network', 'chainId', 'identity', 'metadata', 'metadataError', 'reputation', 'validation', 'links', 'fetchedAt'],
        properties: {
          agentId:  { type: 'integer',  description: 'ERC-8004 token ID.' },
          network:  { type: 'string',   enum: ['mainnet', 'testnet'] },
          chainId:  { type: 'integer',  description: 'EVM chain ID.' },
          identity: {
            type: 'object',
            properties: {
              owner:       { type: 'string', description: 'Token owner address.' },
              agentWallet: { type: 'string', description: 'Designated agent wallet address.' },
              metadataUri: { type: 'string', description: 'Raw IPFS or HTTPS metadata URI.' },
              registries: {
                type: 'object',
                properties: {
                  identity:   { type: 'string' },
                  reputation: { type: 'string' },
                  validation: { type: ['string', 'null'] },
                },
              },
            },
          },
          metadata: {
            type: ['object', 'null'],
            description: 'Parsed agent metadata JSON. Null if IPFS fetch failed.',
            properties: {
              name:        { type: ['string',  'null'] },
              description: { type: ['string',  'null'] },
              services:    { type: ['array',   'null'], items: { type: 'object' } },
              active:      { type: ['boolean', 'null'] },
              x402Support: { type: ['boolean', 'null'] },
            },
          },
          metadataError: { type: ['string', 'null'], description: 'Error code if metadata fetch failed; null on success.' },
          reputation: {
            type: 'object',
            properties: {
              clientCount:    { type: 'integer' },
              feedbackCount:  { type: 'integer' },
              aggregateScore: { type: ['string', 'null'] },
              clients:        { type: 'array', items: { type: 'string' } },
              feedback:       { type: 'array', items: { $ref: '#/components/schemas/FeedbackRecord' } },
            },
          },
          validation: {
            type: 'object',
            properties: {
              available:    { type: 'boolean' },
              reason:       { type: ['string', 'null'] },
              requestCount: { type: ['integer', 'null'] },
              requests:     { type: 'array', items: { $ref: '#/components/schemas/ValidationRequest' } },
            },
          },
          links: {
            type: 'object',
            properties: {
              explorer:        { type: 'string' },
              agentOnExplorer: { type: 'string' },
            },
          },
          fetchedAt: { type: 'string', format: 'date-time' },
        },
      },
      FeedbackRecord: {
        type: 'object',
        properties: {
          client:        { type: 'string' },
          feedbackIndex: { type: 'integer' },
          value:         { type: 'string', description: 'Formatted signed decimal score.' },
          tag1:          { type: ['string', 'null'] },
          tag2:          { type: ['string', 'null'] },
          isRevoked:     { type: 'boolean' },
        },
      },
      ValidationRequest: {
        type: 'object',
        properties: {
          requestHash:      { type: 'string' },
          validatorAddress: { type: 'string' },
          response:         { type: 'integer' },
          responseHash:     { type: 'string' },
          hasResponse:      { type: 'boolean' },
          tag:              { type: ['string', 'null'] },
          lastUpdate:       { type: 'integer', description: 'Unix timestamp.' },
          lastUpdateIso:    { type: 'string',  format: 'date-time' },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error', 'message'],
        properties: {
          error:   { type: 'string', description: 'Machine-readable error code.' },
          message: { type: 'string' },
          agentId: { type: 'integer' },
          network: { type: 'string' },
          chainId: { type: 'integer' },
        },
      },
      PaymentRequiredResponse: {
        type: 'object',
        description: 'x402 Version 2 payment requirements. Returned as the 402 body and in the base64-encoded PAYMENT-REQUIRED header.',
        properties: {
          x402Version: { type: 'integer', enum: [2] },
          resource: {
            type: 'object',
            properties: {
              url:         { type: 'string' },
              description: { type: 'string' },
              mimeType:    { type: 'string' },
            },
          },
          accepts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                scheme:            { type: 'string', enum: ['exact'] },
                network:           { type: 'string', description: 'CAIP-2 network ID. eip155:5042 = Arc Mainnet.' },
                asset:             { type: 'string', description: 'USDC contract address on the payment network.' },
                amount:            { type: 'string', description: 'Payment amount in smallest USDC units (6 decimals). 10000 = 0.01 USDC.' },
                payTo:             { type: 'string', description: "Seller's EVM receive address." },
                maxTimeoutSeconds: { type: 'integer' },
                extra: {
                  type: 'object',
                  properties: {
                    name:              { type: 'string', enum: ['GatewayWalletBatched'] },
                    version:           { type: 'string', enum: ['1'] },
                    verifyingContract: { type: 'string', description: 'Circle GatewayWallet contract address.' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
    return res.status(204).end()
  }
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).json(spec)
}
