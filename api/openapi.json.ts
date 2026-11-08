/**
 * GET /api/openapi.json
 * Returns the OpenAPI 3.1 specification for the Arc ERC-8004 Explorer API.
 * arc-studio-allow-onchain-literal (example values in OpenAPI spec are documented fixtures)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  MAX_TIMEOUT_SECONDS,
  PAYMENT_NETWORKS,
  PRICE_ATOMIC,
  PRICE_USD,
  RESOURCE_URL,
  SERVICE_DESCRIPTION,
  SERVICE_ICON_URL,
  SERVICE_NAME,
  SERVICE_TAGS,
} from './_lib/x402-config.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const spec = {
  openapi: '3.1.0',
  info: {
    title:       'Arc ERC-8004 Explorer API',
    version:     '1.4.0',
    description: 'Read-only public API for resolving ERC-8004 agent identities on Arc Mainnet. Paid x402 endpoint only. No write operations.',
    contact: { url: 'https://www.arcagents.app', email: 'hi@arcagents.app' },
    'x-agent-consumable': true,
    'x-guidance': [
      'ARC AGENTS API — guidance for AI agents',
      '',
      'SERVICE: Resolve ERC-8004 on-chain agent identities registered on the Arc blockchain.',
      'Returns: owner address, agent wallet, IPFS metadata (name, description, services), reputation score and client feedback, and validation status.',
      '',
      'ENDPOINT — GET /api/agent/paid',
      '  Required: network=mainnet, agentId (positive integer)',
      `  Cost: ${PRICE_USD} USDC per successful request (${PRICE_ATOMIC} atomic units, 6 decimals)`,
      '  Payment: x402 Version 2, scheme "exact" (EIP-3009 transferWithAuthorization), verified and settled by Circle Facilitator Service. USDC is paid directly to the seller address in payTo.',
      '  Accepted payment networks (payer\'s choice — ERC-8004 data always comes from Arc Mainnet):',
      ...PAYMENT_NETWORKS.map(n => `    • ${n.name.padEnd(12)} — ${n.caip2.padEnd(11)} — USDC ${n.asset} (EIP-712 domain: name "${n.domainName}", version "${n.domainVersion}"; amount = ${PRICE_ATOMIC})`),
      '  The EIP-712 domain name differs per network; copy accepts[].extra.name and accepts[].extra.version from the chosen entry.',
      '  Flow: 1) Send GET without PAYMENT-SIGNATURE → receive 402 with PAYMENT-REQUIRED header.',
      '         2) Decode PAYMENT-REQUIRED (base64 JSON) — accepts[] lists both networks.',
      `         3) Choose one payment network. Sign an EIP-3009 authorization for ${PRICE_ATOMIC} USDC units on that network.`,
      '         4) Base64-encode the signed payload → PAYMENT-SIGNATURE header.',
      '         5) Resend GET with PAYMENT-SIGNATURE → receive 200 AgentResponse and a PAYMENT-RESPONSE header on success.',
      '  A 404 or 503 is returned before settlement and is never charged. A 503 payment_pending means settlement is not confirmed: no data is returned, do not pay again until the payment status is checked.',
      '  Returns: AgentResponse (identity, metadata, reputation, validation).',
      '  Mainnet only: network=testnet returns 400.',
      '',
      'WHEN TO CALL:',
      '  - Call /api/agent/paid to resolve ERC-8004 agent identity, metadata, reputation, and validation data.',
      '  - The endpoint is read-only and safe to call without fear of side effects.',
      '',
      'AGENT IDs: on Arc Mainnet, confirmed agents include #1, #8, #14, #15.',
      'A 404 means the agent ID is not minted on Arc Mainnet.',
    ].join('\n'),
  },
  externalDocs: {
    description: 'Arc ERC-8004 Explorer',
    url:         'https://www.arcagents.app',
  },
  servers: [
    { url: 'https://www.arcagents.app', description: 'Production' },
    { url: 'https://arcagents.app',     description: 'Production (bare domain)' },
  ],
  paths: {
    '/api/agent/paid': {
      get: {
        operationId: 'getAgentPaid',
        summary:     `Resolve an ERC-8004 agent by ID (paid, ${PRICE_USD} USDC)`,
        description: `Returns ERC-8004 agent identity, metadata, reputation, and validation data. Requires an x402 v2 "exact" payment of ${PRICE_USD} USDC (${PRICE_ATOMIC} atomic units) verified and settled by Circle Facilitator Service, paid directly to the seller address. ERC-8004 data is always resolved from Arc Mainnet (network=mainnet). Payment can be made on either of two networks: ${PAYMENT_NETWORKS.map(n => `${n.name} (${n.caip2}, USDC ${n.asset})`).join(' or ')}. The 402 response lists both networks in accepts[] and carries Bazaar discovery metadata in extensions.bazaar. Only network=mainnet is accepted as the ERC-8004 data network. Requires a PAYMENT-SIGNATURE header containing a base64-encoded x402 Version 2 payment payload; a successful response includes a PAYMENT-RESPONSE header with the settlement transaction.`,
        'x-payment-info': {
          price: {
            mode:     'fixed',
            currency: 'USD',   // x402scan requires decimal-USD denomination, not token symbol
            amount:   '0.002000',
          },
          protocols: [
            { x402: {} },
          ],
        },
        parameters: [
          {
            name: 'network', in: 'query', required: true,
            description: "Must be 'mainnet'. The paid endpoint resolves ERC-8004 data from Arc Mainnet only.",
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
            description: 'Payment required or payment rejected. The PAYMENT-REQUIRED header contains a base64-encoded x402 Version 2 payment requirements object that also carries the Bazaar discovery metadata in extensions.bazaar (abbreviated in the example below). When a submitted payment is rejected or fails to settle, the body is an ErrorResponse (error: payment_invalid or payment_failed) and the PAYMENT-REQUIRED header is still returned.',
            headers: {
              'PAYMENT-REQUIRED': {
                description: `Base64-encoded JSON payment requirements (x402 Version 2). Decode to read accepts[], which lists two payment options: ${PAYMENT_NETWORKS.map(n => `${n.name} (${n.caip2})`).join(' and ')}. Choose one, sign an EIP-3009 authorization for ${PRICE_ATOMIC} USDC units on that network using the EIP-712 domain in accepts[].extra, base64-encode the payload, and resend as the PAYMENT-SIGNATURE header.`,
                schema: { type: 'string', format: 'byte' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentRequiredResponse' },
                example: {
                  x402Version: 2,
                  resource: {
                    url:         RESOURCE_URL,
                    description: SERVICE_DESCRIPTION,
                    mimeType:    'application/json',
                    serviceName: SERVICE_NAME,
                    tags:        SERVICE_TAGS,
                    iconUrl:     SERVICE_ICON_URL,
                  },
                  accepts: PAYMENT_NETWORKS.map(n => ({
                    scheme:            'exact',
                    network:           n.caip2,
                    asset:             n.asset,
                    amount:            PRICE_ATOMIC,
                    payTo:             '0x<SELLER_ADDRESS>',
                    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
                    extra:             { name: n.domainName, version: n.domainVersion },
                  })),
                  extensions: {
                    bazaar: {
                      info: {
                        input: { type: 'http', method: 'GET', queryParams: { network: 'mainnet', agentId: 15 } },
                        output: { type: 'json', example: '(AgentResponse example; see the PAYMENT-REQUIRED header)' },
                      },
                      schema: '(JSON Schema for the query parameters and the AgentResponse output; see the PAYMENT-REQUIRED header)',
                    },
                  },
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
            description: 'Not charged: the RPC call failed, or the payment service could not verify the payment (error: rpc_error or payment_service_unavailable). Also returned as error: payment_pending when settlement is not confirmed; no data is returned and the settlement is never retried by the server, so do not pay again until the payment status is checked.',
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
        // security: [] tells x402scan this endpoint is free/public and must not be probed
        // for a 402 payment challenge. Without this, x402scan probes it, receives 200, and
        // reports "No valid x402 response found", which prevents /api/agent/paid registration.
        security:    [],
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
          network:  { type: 'string',   enum: ['mainnet'] },
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
        description: `x402 Version 2 payment requirements. Returned as the 402 body and in the base64-encoded PAYMENT-REQUIRED header. accepts[] contains one entry per supported payment network (${PAYMENT_NETWORKS.map(n => `${n.name} ${n.caip2}`).join(' and ')}). ERC-8004 data is always resolved from Arc Mainnet regardless of which payment network is used.`,
        properties: {
          x402Version: { type: 'integer', enum: [2] },
          error:       { type: 'string', description: 'Present when a submitted payment was rejected (payment_invalid or payment_failed).' },
          resource: {
            type: 'object',
            properties: {
              url:         { type: 'string' },
              description: { type: 'string' },
              mimeType:    { type: 'string' },
              serviceName: { type: 'string', description: 'Human-readable service name for catalogs.' },
              tags:        { type: 'array', items: { type: 'string' }, description: 'Short topical tags for discovery search.' },
              iconUrl:     { type: 'string', description: 'Absolute https URL of the service icon.' },
            },
          },
          accepts: {
            type: 'array',
            description: `List of accepted payment options, one per network: ${PAYMENT_NETWORKS.map(n => `${n.name} (${n.caip2})`).join(' and ')}. Choose one to pay with.`,
            items: {
              type: 'object',
              properties: {
                scheme:            { type: 'string', enum: ['exact'] },
                network:           { type: 'string', description: `CAIP-2 network ID. ${PAYMENT_NETWORKS.map(n => `${n.caip2} = ${n.name}`).join('; ')}.` },
                asset:             { type: 'string', description: `USDC contract address on the payment network. ${PAYMENT_NETWORKS.map(n => `${n.name}: ${n.asset}`).join('; ')}.` },
                amount:            { type: 'string', description: `Payment amount in smallest USDC units (6 decimals). ${PRICE_ATOMIC} = ${PRICE_USD} USDC.` },
                payTo:             { type: 'string', description: "Seller's external EVM receive address. USDC is transferred here directly." },
                maxTimeoutSeconds: { type: 'integer', description: `How long a signed authorization stays valid (${MAX_TIMEOUT_SECONDS} seconds).` },
                extra: {
                  type: 'object',
                  description: 'EIP-712 domain of the USDC contract on this network, needed to sign the EIP-3009 authorization. It differs per network.',
                  properties: {
                    name:    { type: 'string', description: PAYMENT_NETWORKS.map(n => `${n.name}: "${n.domainName}"`).join('; ') },
                    version: { type: 'string', description: 'EIP-712 domain version ("2" on both networks).' },
                  },
                },
              },
            },
          },
          extensions: {
            type: 'object',
            description: 'x402 extensions. extensions.bazaar is the official Bazaar discovery declaration: info.input (HTTP GET with the query parameters network and agentId), info.output (a real example response), and a JSON Schema for both.',
            properties: {
              bazaar: { type: 'object', description: 'Bazaar discovery extension (info + schema).' },
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
