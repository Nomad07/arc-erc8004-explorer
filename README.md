# Arc ERC-8004 Explorer

A read-only explorer and API for discovering and inspecting ERC-8004 agents on Arc.

**Live Explorer:** https://arcagents.app/

[Check the current Circle agent-readiness score](https://agents.circle.com/sell/score?url=www.arcagents.app)

## Overview

**Arc ERC-8004 Explorer** provides two ways to access ERC-8004 agent data:

* **Free manual Explorer** for people
* **Paid API** for AI agents, bots, automated workflows, and programmatic integrations

The Explorer supports ERC-8004 agent discovery and inspection on **Arc Mainnet** and **Arc Testnet**.

The paid API uses **x402 Version 2** (`exact` scheme) with **Circle Facilitator Service** for machine-to-machine USDC payments.

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

API access costs **$0.002 per successful request** (2000 atomic USDC units) and uses x402 payments verified and settled by Circle Facilitator Service.

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
* x402 Version 2 (`exact`, EIP-3009)
* Circle Facilitator Service
* USDC payments on Arc Mainnet and Base Mainnet
* Machine-readable JSON responses
* `$0.002` per successful request
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

**Price:** `$0.002 / successful request` (2000 atomic USDC units, 6 decimals)

**Payment protocol:** x402 Version 2, `exact` scheme (EIP-3009 authorization)

**Payment facilitator:** Circle Facilitator Service

USDC is paid directly to the seller address advertised in the payment requirements (`payTo`).

Example:

```text
GET https://www.arcagents.app/api/agent/paid?network=mainnet&agentId=15
```

An unpaid request returns `402 Payment Required` with the available x402 payment requirements, including Bazaar discovery metadata (`extensions.bazaar`).

### Payment Networks

The endpoint advertises two payment networks:

| Payment network | CAIP-2        | USDC                                         | EIP-712 domain (name / version) |
| --------------- | ------------- | -------------------------------------------- | ------------------------------- |
| Arc Mainnet     | `eip155:5042` | `0x3600000000000000000000000000000000000000` | `USDC` / `2`                    |
| Base Mainnet    | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `USD Coin` / `2`                |

**Important:** ERC-8004 data is always resolved from **Arc Mainnet**. Base Mainnet is a payment network only. The EIP-712 domain name differs per network, so use `accepts[].extra` from the chosen entry when signing.

### Payment Availability

Arc Mainnet and Base Mainnet are both listed by Circle as supported for the x402 `exact` scheme on Facilitator Service.

Live settlement through this endpoint is pending production verification. A payment is only treated as complete when Circle confirms settlement with a transaction hash on the expected network. If settlement cannot be confirmed, the API returns no data and does not retry the settlement.

The server keeps no payment state of its own. Clients built for the previous Circle Gateway batched scheme are no longer supported; use a standard x402 v2 `exact` (EIP-3009) client. The stock x402 client only signs assets it knows, so a buyer on Arc must explicitly allow the Arc USDC contract.

### Configuration

The paid endpoint reads two server environment variables:

* `SELLER_ADDRESS`: EVM address that receives the USDC payments
* `CIRCLE_FACILITATOR_API_KEY`: Circle API key used to call Facilitator Service

## Payment Capabilities

The endpoint currently provides:

* 1 paid endpoint
* `$0.002 / successful request`
* x402 Version 2, `exact` scheme
* USDC payment requirements on Arc Mainnet and Base Mainnet
* Bazaar discovery metadata in the `402` response

## Circle AI-Agent Readiness

Circle publishes an agent-readiness score for the paid API:

https://agents.circle.com/sell/score?url=www.arcagents.app

An earlier version of the paid API (using Circle Gateway) was reported as 100/100 and runtime-verified. The payment integration has since changed to Circle Facilitator Service, so that result is historical. The score for the current version has not been re-verified; check the link above for the current status.

## API Payment Flow

1. An AI agent requests the paid endpoint.
2. The API returns `402 Payment Required`.
3. The response exposes the available payment requirements.
4. The agent provides a valid x402 payment payload (`PAYMENT-SIGNATURE` header).
5. Circle Facilitator Service verifies the payment.
6. The API resolves the requested ERC-8004 agent from Arc Mainnet. A missing agent is not charged.
7. Circle Facilitator Service settles the payment once.
8. Only after Circle confirms settlement with a transaction hash on the expected network, the API returns the agent data as JSON with a `PAYMENT-RESPONSE` header.

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
* Circle Facilitator Service
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

Run the API tests (no network, no real payments):

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

See Circle's agent-readiness page (linked above) for the current readiness status of the paid API.

## License

MIT
