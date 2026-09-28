# Arc ERC-8004 Explorer

An explorer for discovering and inspecting ERC-8004 agents on Arc.

**Live Explorer:** https://arcagents.app/

## Overview

**Arc ERC-8004 Explorer** lets users search for and inspect ERC-8004 agents directly on Arc Mainnet and Arc Testnet.

Enter an Agent ID and the explorer resolves the agent on the selected network, then displays its identity, ownership, wallet, metadata, reputation, and validation data.

No wallet connection is required.

## Features

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

## How It Works

1. Select **Arc Mainnet** or **Arc Testnet**.
2. Enter an ERC-8004 Agent ID.
3. The explorer reads the agent from the selected Identity Registry.
4. Identity, reputation, and validation data are loaded for that agent.
5. Use the explorer links to inspect the underlying onchain records.

The explorer reads public onchain data and does not require users to connect a wallet.

## API

The Explorer exposes a public JSON API for programmatic and AI agent access.

### `GET /api/agent` — free

Returns ERC-8004 agent identity, metadata, reputation, and validation data.

```
GET https://arcagents.app/api/agent?network=mainnet&agentId=15
GET https://arcagents.app/api/agent?network=testnet&agentId=98
```

No authentication. No wallet. CDN-cached 30 seconds.

### `GET /api/agent/paid` — 0.01 USDC (x402)

Same data as the free endpoint, gated by a [Circle Gateway](https://developers.circle.com/gateway) x402 micropayment of **0.01 USDC** per request. Intended for AI agents and automated workflows.

- ERC-8004 data is always resolved from **Arc Mainnet** (`network=mainnet`)
- Payment can be made on **either** of the following networks (payer's choice):

| Payment network | CAIP-2        | USDC address                                   |
|-----------------|---------------|------------------------------------------------|
| Arc Mainnet     | `eip155:5042` | `0x3600000000000000000000000000000000000000`   |
| Base Mainnet    | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`  |

Payment flow (x402 Version 2):
1. `GET /api/agent/paid?network=mainnet&agentId=15` → **402** with `PAYMENT-REQUIRED` header
2. Decode `PAYMENT-REQUIRED` (base64 JSON) — `accepts[]` lists both payment networks
3. Choose one network, sign a GatewayWalletBatched EIP-3009 authorization for `10000` USDC units
4. Base64-encode the signed payload → `X-PAYMENT` header
5. Resend `GET` with `X-PAYMENT` → **200** `AgentResponse` on success

### `GET /api/openapi.json`

Full OpenAPI 3.1 specification for the API.

```
GET https://arcagents.app/api/openapi.json
```

---

## Tech Stack

* React
* TypeScript
* Vite
* wagmi
* viem
* CSS
* ERC-8004
* Circle Gateway / x402

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
```

## Deployment

The production application is deployed and available at:

**https://arcagents.app/**

## Status

**Live**

The explorer currently supports ERC-8004 agent inspection on both Arc Mainnet and Arc Testnet.

## License

MIT
