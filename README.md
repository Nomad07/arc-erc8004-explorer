# Arc ERC-8004 Explorer

A read-only explorer and paid API for discovering and inspecting ERC-8004 agents on Arc.

**Live Explorer:** [https://www.arcagents.app/](https://www.arcagents.app/)

**Circle Agent Readiness:** [100/100](https://agents.circle.com/sell/score?url=www.arcagents.app)

## Overview

**Arc ERC-8004 Explorer** provides two ways to access ERC-8004 agent data:

- **Free manual Explorer** for people.
- **Paid API** for AI agents, bots, automated workflows, and programmatic integrations.

The Explorer supports ERC-8004 agent discovery and inspection on **Arc Mainnet** and **Arc Testnet**.

The paid API uses **x402 Version 2** (`exact` scheme) with the **Ultravioleta DAO facilitator** for machine-to-machine USDC payments.

Live production payments through the Ultravioleta DAO facilitator have been successfully verified on both Arc Mainnet and Base Mainnet.

### Access Model

#### Free Manual Explorer

**Free for everyone.**

Users can manually search and inspect ERC-8004 agents through the web interface.

The Explorer provides:

- Agent identity
- Agent owner
- Agent wallet
- Metadata
- Reputation
- Validation data
- Direct onchain explorer links

#### Paid API for Agents and Automation

The API is designed for:

- AI agents
- Bots
- Automated workflows
- Programmatic integrations

API access costs **$0.002 per successful request** and uses x402 payments through the Ultravioleta DAO facilitator.

No facilitator account or API key is required.

## Features

### Explorer

- Search ERC-8004 agents by Agent ID
- Arc Mainnet and Arc Testnet support
- ERC-8004 Identity Registry data
- Agent owner and agent wallet
- Agent metadata URI
- Reputation feedback and aggregate score
- Validation requests and responses
- Direct links to Arc Explorer
- Copy agent and registry addresses
- Responsive desktop, tablet, and mobile layouts
- Onchain agent data
- Not-found handling for invalid Agent IDs

### AI Agent API

- Paid ERC-8004 agent resolver
- x402 Version 2 (`exact`, EIP-3009)
- Ultravioleta DAO x402 facilitator
- USDC payments on Arc Mainnet and Base Mainnet
- Machine-readable JSON responses
- `$0.002` per successful request
- ERC-8004 data from Arc Mainnet

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
4. Identity, reputation, metadata, and validation data are loaded.
5. Use the explorer links to inspect the underlying onchain records.

## Paid API

### Endpoint

`GET /api/agent/paid`

Retrieve ERC-8004 agent identity and registration data from Arc Mainnet through x402 v2 payments.

The paid endpoint returns data from **Arc Mainnet only**. It does not provide Arc Testnet data. Testnet agents can be inspected through the free manual Explorer.

### Pricing and Payment

**Price:** `$0.002` per successful request (2000 atomic USDC units, 6 decimals).

**Payment protocol:** x402 Version 2, `exact` scheme (EIP-3009 authorization).

**Payment facilitator:** Ultravioleta DAO.

Facilitator: [https://facilitator.ultravioletadao.xyz](https://facilitator.ultravioletadao.xyz)

USDC is paid directly to the seller address advertised in the payment requirements (`payTo`).

### Example Request

```http
GET https://www.arcagents.app/api/agent/paid?network=mainnet&agentId=15
```

An unpaid request returns `402 Payment Required` with the available x402 payment requirements, including Bazaar discovery metadata.

After successful payment, the API returns the requested agent data as JSON.

### Supported Payment Networks

The endpoint supports two payment networks:

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

Arc ERC-8004 Explorer currently has a **100/100 Circle Agent Readiness score**.

[View the Circle Agent Readiness assessment](https://agents.circle.com/sell/score?url=www.arcagents.app)

## OpenAPI Specification

The project publishes an OpenAPI specification for programmatic API discovery:

[https://www.arcagents.app/api/openapi.json](https://www.arcagents.app/api/openapi.json)

The paid API operation includes payment information describing the fixed `$0.002` price and x402 protocol.

## Discovery

The paid endpoint publishes Bazaar discovery metadata in its `402 Payment Required` response, including the request parameters, response example, JSON Schemas, service name, description, tags, and icon.

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
