# Arc ERC-8004 Explorer

A read-only explorer and API for discovering and inspecting ERC-8004 agents on Arc.

**Live Explorer:** https://arcagents.app/

<a href="https://agents.circle.com/sell/score?url=www.arcagents.app"><img src="https://img.shields.io/badge/Circle%20Agent%20Ready-100%2F100-0F6BFF?style=for-the-badge&logo=circle&logoColor=white" alt="Circle Agent Ready — 100/100"></a>

## Overview

**Arc ERC-8004 Explorer** provides two ways to access ERC-8004 agent data:

* **Free manual Explorer** for people
* **Paid API** for AI agents, bots, automated workflows, and programmatic integrations

The Explorer supports ERC-8004 agent discovery and inspection on **Arc Mainnet** and **Arc Testnet**.

The paid API uses **x402 Version 2** and **Circle Gateway** for machine-to-machine payments.

## Access Model

### Free Manual Explorer

**Free for everyone.**

Users can manually search and inspect ERC-8004 agents through the web interface.

No wallet connection and no payment are required.

The Explorer provides:

* Agent identity
* Agent owner
* Agent wallet
* Metadata
* Reputation
* Validation data
* Direct onchain explorer links

### Paid API for Agents and Automation

The API is designed for:

* AI agents
* Bots
* Automated workflows
* Programmatic integrations

API access costs **$0.01 per call** and uses x402 payments through Circle Gateway.

This keeps manual exploration free while providing a payment-based API for automated and programmatic access.

## Features

### Explorer

* Search ERC-8004 agents by Agent ID
* Arc Mainnet and Arc Testnet support
* ERC-8004 Identity Registry data
* Agent owner and agent wallet
* Agent metadata URI
* Reputation feedback and aggregate score
* Validation requests and responses
* Direct links to Arc Explorer
* Copy agent and registry addresses
* Responsive desktop, tablet, and mobile layouts
* Onchain agent data
* Not-found handling for invalid Agent IDs
* No wallet connection required

### AI Agent API

* Paid ERC-8004 agent resolver
* x402 Version 2
* Circle Gateway
* Nanopayments
* Multi-chain payment support
* Machine-readable JSON responses
* `$0.01` per call
* Strictly read-only ERC-8004 data access

## Supported Networks

### Arc Mainnet

* Chain ID: `5042`
* Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
* Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
* Validation Registry: Not deployed

### Arc Testnet

* Chain ID: `5042002`
* Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
* Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
* Validation Registry: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`

## How the Explorer Works

1. Select **Arc Mainnet** or **Arc Testnet**.
2. Enter an ERC-8004 Agent ID.
3. The Explorer reads the agent from the selected Identity Registry.
4. Identity, reputation, metadata, and validation data are loaded.
5. Use the explorer links to inspect the underlying onchain records.

The Explorer reads public onchain data and does not require users to connect a wallet.

## Paid API

### `GET /api/agent/paid`

The paid endpoint resolves ERC-8004 agent data from **Arc Mainnet**.

**Price:** `$0.01 / call`

**Payment protocol:** x402 Version 2

**Payment facilitator:** Circle Gateway

Example:

```text
GET https://www.arcagents.app/api/agent/paid?network=mainnet&agentId=15
```

An unpaid request returns `402 Payment Required` with the available x402 payment requirements.

### Payment Networks

The endpoint currently advertises three payment networks:

| Payment network | CAIP-2         | USDC                                         |
| --------------- | -------------- | -------------------------------------------- |
| Arc Mainnet     | `eip155:5042`  | `0x3600000000000000000000000000000000000000` |
| Base Mainnet    | `eip155:8453`  | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum One    | `eip155:42161` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |

**Important:** ERC-8004 data is always resolved from **Arc Mainnet**. Base and Arbitrum are payment networks only.

### Current Payment Availability

**Base Mainnet and Arbitrum One currently support live payment settlement.**

Arc Mainnet is included in the x402 payment requirements, but live Arc payment settlement is currently unavailable through the public Circle Gateway.

This is a **Circle Gateway availability limitation, not an issue with the Arc ERC-8004 Explorer implementation**.

The Arc payment configuration remains available in the endpoint requirements so the payment rail can be used when public Circle Gateway settlement becomes available.

## Payment Capabilities

Circle currently verifies the endpoint with:

* **Nanopayments**
* **Multi-chain**

The endpoint currently provides:

* 1 paid endpoint
* `$0.01 / call`
* x402 Version 2
* USDC payment requirements
* Multi-network payment support

## Circle AI-Agent Readiness

The paid API has been runtime-verified by Circle:

| Metric          | Result                |
| --------------- | --------------------- |
| Readiness score | **100/100**           |
| Trust tier      | **Runtime-verified**  |
| Status          | **Fully agent-ready** |
| Endpoints       | **1**                 |
| Price           | **$0.01 / call**      |

Circle currently reports that there is nothing to improve for agent discovery and payment readiness.

## API Payment Flow

1. An AI agent requests the paid endpoint.
2. The API returns `402 Payment Required`.
3. The response exposes the available payment requirements.
4. The agent provides a valid x402 payment payload.
5. Circle Gateway verifies and settles the payment.
6. The API resolves the requested ERC-8004 agent from Arc Mainnet.
7. The API returns the agent data as JSON.

The API is strictly read-only:

* No private keys
* No custodial wallet
* No user wallet connection
* No ERC-8004 write operations
* No modification of onchain agent data

## Retired Free API

The former free API endpoint has been permanently retired:

```text
GET /api/agent
```

It now returns:

```text
410 Gone
```

The current API endpoint for agents and automated systems is:

```text
GET /api/agent/paid
```

## OpenAPI

The project exposes an OpenAPI specification for programmatic API discovery:

```text
https://www.arcagents.app/api/openapi.json
```

## Tech Stack

* React
* TypeScript
* Vite
* wagmi
* viem
* CSS
* ERC-8004
* Circle Gateway
* x402 Version 2
* Vercel

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

Production Explorer:

https://arcagents.app/

Paid API:

https://www.arcagents.app/api/agent/paid

## Releases

Version history:

https://github.com/Nomad07/arc-erc8004-explorer/releases

Current release: **v1.1.3**

## Status

**Live**

Arc ERC-8004 Explorer is live on Arc Mainnet and Arc Testnet.

The manual Explorer is free to use.

The paid API is live for AI agents, bots, automated workflows, and programmatic integrations.

The paid API is runtime-verified by Circle with a **100/100 agent-readiness score**.

## License

MIT
