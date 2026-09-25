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
    version:     '1.0.0',
    description: 'Read-only public API for resolving ERC-8004 agent identities on Arc Mainnet and Arc Testnet. No authentication required. No write operations.',
    contact: { url: 'https://arcagents.app' },
  },
  servers: [
    { url: 'https://arcagents.app', description: 'Production' },
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
