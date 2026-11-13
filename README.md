# Arc ERC-8004 Explorer

An ERC-8004 Explorer for **Arc Mainnet and Arc Testnet**, with a paid API for programmatic access to agent data. The web Explorer lets users search and inspect agents on both networks. The API resolves ERC-8004 data from **Arc Mainnet** and accepts x402 payments on **Arc Mainnet and Base Mainnet**.

## Overview

Arc ERC-8004 Explorer provides two ways to access ERC-8004 agent data:

- **Free Explorer:** Manual search and inspection through the web interface.
- **Paid API:** Programmatic access for AI agents, bots, automated workflows, and integrations.

The paid API uses **x402 Version 2** (`exact` scheme) with the **Ultravioleta DAO facilitator** for machine-to-machine USDC payments.

Live production payments through the Ultravioleta DAO facilitator have been successfully verified on both Arc Mainnet and Base Mainnet.

## Features

### Explorer

The web interface supports manual discovery and inspection of ERC-8004 agents on Arc Mainnet and Arc Testnet.

- Search agents by Agent ID
- Read ERC-8004 Identity Registry data
- Inspect agent ownership and wallet addresses
- View agent metadata and metadata URI
- Inspect reputation feedback and aggregate scores
- View available validation requests and responses where supported by the network
- Open direct links to Arc Explorer
- Copy agent and registry addresses
- Responsive desktop, tablet, and mobile layouts
- Onchain data with not-found handling for invalid Agent IDs

### AI Agent API

A paid API for programmatic access to ERC-8004 agent data.

- Paid ERC-8004 agent resolver
- x402 Version 2 (`exact`, EIP-3009)
- Ultravioleta DAO x402 facilitator
- USDC payment support on Arc Mainnet and Base Mainnet
- Machine-readable JSON responses
- ERC-8004 data resolved from Arc Mainnet

### Poncho Integration

**Arc ERC-8004 Explorer is available on Poncho.**

[Open Arc ERC-8004 Explorer on Poncho](https://tryponcho.com/m/arcagents.app)

AI agents can query ERC-8004 agent data through Poncho, including:

- Agent identity and registration
- Owner and wallet addresses
- Metadata and metadata URI
- Reputation feedback and aggregate score
- Available validation requests and responses

Users provide Agent IDs directly in the conversation. Poncho does not automatically select Agent IDs.

**Poncho payment support:** USDC payments on Base Mainnet only. Arc Mainnet wallet payments are not yet supported through Poncho.

This is a limitation of the Poncho integration. The underlying API supports x402 payments on both Arc Mainnet and Base Mainnet.

## Supported Networks

### Arc Mainnet

- Chain ID: `5042`
- CAIP-2: `eip155:5042`
- Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- Validation Registry: Not deployed

### Arc Testnet

- Chain ID: `5042002`
- CAIP-2: `eip155:5042002`
- Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- Validation Registry: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`

## How It Works

1. Select **Arc Mainnet** or **Arc Testnet**.
2. Enter an ERC-8004 Agent ID.
3. The Explorer reads the agent from the selected Identity Registry.
4. Available identity, reputation, metadata, and validation data are loaded.
5. Use the explorer links to inspect the underlying onchain records.

## Paid API

### Endpoint

`GET /api/agent/paid`

The endpoint retrieves ERC-8004 agent identity and registration data from **Arc Mainnet** through x402 v2 payments.

The paid API does not provide Arc Testnet data. Testnet agents can be inspected through the free manual Explorer.

### Pricing and Payment

- **Price:** `$0.002` per successful request (2000 atomic USDC units, 6 decimals).
- **Payment protocol:** x402 Version 2, `exact` scheme (EIP-3009 authorization).
- **Payment facilitator:** Ultravioleta DAO.

Facilitator: [https://facilitator.ultravioletadao.xyz](https://facilitator.ultravioletadao.xyz)

USDC is paid directly to the seller address advertised in the payment requirements (`payTo`).

### Example Request

```http
GET https://www.arcagents.app/api/agent/paid?network=mainnet&agentId=15
```

An unpaid request returns `402 Payment Required` with the available x402 payment requirements, including Bazaar discovery metadata.

After successful payment, the API returns the requested agent data as JSON.

### Supported Payment Networks

The endpoint accepts payments on two networks:

| Payment Network | CAIP-2 | USDC Contract | EIP-712 Domain |
| --- | --- | --- | --- |
| Arc Mainnet | `eip155:5042` | `0x3600000000000000000000000000000000000000` | `USDC` / `2` |
| Base Mainnet | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `USD Coin` / `2` |

**Important:** ERC-8004 data is always resolved from **Arc Mainnet**. Base Mainnet is a payment network only. The EIP-712 domain name differs by network, so clients should use `accepts[].extra` from the selected payment requirement when signing.

### Configuration

The paid endpoint uses one server environment variable:

- `SELLER_ADDRESS`: EVM address that receives USDC payments.

The Ultravioleta DAO facilitator does not require an API key.

## Circle Agent Readiness

Arc ERC-8004 Explorer has a **100/100 Circle Agent Readiness score**.

[View the Circle Agent Readiness assessment](https://agents.circle.com/sell/score?url=www.arcagents.app)

## OpenAPI Specification

The project publishes an OpenAPI specification for programmatic API discovery:

[https://www.arcagents.app/api/openapi.json](https://www.arcagents.app/api/openapi.json)

The paid API operation includes payment information describing the fixed `$0.002` price and x402 protocol.

## Discovery

The paid endpoint publishes Bazaar discovery metadata in its `402 Payment Required` response, including request parameters, response examples, JSON Schemas, service name, description, tags, and icon.

Listings:

- [Ultravioleta DAO Bazaar](https://facilitator.ultravioletadao.xyz/bazaar?q=www.arcagents.app)
- [x402 Bazaar](https://x402-bazaar.com/resources/6af36d3129802b0f3634caf5)

## Tech Stack

- React
- TypeScript
- Vite
- wagmi
- viem
- CSS
- ERC-8004
- Ultravioleta DAO x402 facilitator
- `uvd-x402-sdk`
- x402 Version 2
- Vercel

## Local Development

Install dependencies:

```bash
bun install
```

Start the development server:

```bash
bun run dev
```

Run checks:

```bash
bun run check
```

Run API tests:

```bash
bun run test
```

## Project Structure

```text
src/
├── components/
├── App.tsx
└── main.tsx

api/
├── agent/
│   └── paid.ts
└── ...
```

## Deployment

**Production Explorer:**

[https://www.arcagents.app/](https://www.arcagents.app/)

**Paid API:**

[https://www.arcagents.app/api/agent/paid](https://www.arcagents.app/api/agent/paid)

## Releases

[GitHub Releases](https://github.com/Nomad07/arc-erc8004-explorer/releases)

Current release: **v1.1.3**

## License

MIT
