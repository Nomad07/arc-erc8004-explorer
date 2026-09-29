# Arc ERC-8004 Explorer

An explorer for discovering and inspecting ERC-8004 agents on Arc Mainnet and Arc Testnet, with a paid x402 API for machine/AI access.

**Live:** https://arcagents.app/

---

## What This App Does

**Arc ERC-8004 Explorer** lets users and agents look up ERC-8004 agents by ID on Arc Mainnet or Arc Testnet. It displays identity (owner, agent wallet, metadata URI), reputation (clients, feedback, aggregate score), and validation data, all read live from the onchain registries.

No wallet connection is required for the human Explorer. The paid API endpoint accepts Circle Gateway x402 micropayments.

---

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, wagmi v2, viem v2, ConnectKit
- **API:** Vercel serverless functions (TypeScript), viem public clients
- **Contracts (imported, read-only):** Solidity 0.8.28, Foundry — sources in `contracts/imported/`, build with `bun run contracts:build`, test with `bun run contracts:test`
- **Payment:** Circle Gateway Nanopayments, x402 Version 2, `@circle-fin/x402-batching`
- **Fonts:** DM Sans, Space Grotesk, JetBrains Mono (Google Fonts)

---

## Key Files

- `src/App.tsx` — thin composition root; renders `<AgentDashboard />`
- `src/components/AgentDashboard.tsx` — entire ERC-8004 Explorer UI (read-only, no wallet required)
- `src/config.ts` — wagmi config (Arc Testnet, Arc Mainnet, Ethereum Mainnet for ENS)
- `src/onchain-facts.ts` — chain/token facts registry (Arc, Base, Ethereum, etc.)
- `api/_lib/networks.ts` — ERC-8004 registry addresses for Arc Mainnet and Arc Testnet
- `api/_lib/rpc.ts` — viem public clients for Arc Mainnet and Arc Testnet
- `api/_lib/resolve.ts` — shared ERC-8004 agent resolution logic (identity, reputation, validation)
- `api/_lib/types.ts` — TypeScript types for API responses
- `api/_lib/ipfs.ts` — IPFS gateway fetch with timeout and fallback
- `api/agent.ts` — `GET /api/agent` free endpoint
- `api/agent/paid.ts` — `GET /api/agent/paid` x402 paid endpoint
- `api/openapi.json.ts` — `GET /api/openapi.json` OpenAPI 3.1 spec

---

## ERC-8004 Networks (data only)

| Network      | Chain ID | Identity Registry                            | Reputation Registry                          | Validation Registry                          |
|--------------|----------|----------------------------------------------|----------------------------------------------|----------------------------------------------|
| Arc Mainnet  | 5042     | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Not deployed                                 |
| Arc Testnet  | 5042002  | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

---

## API

### `GET /api/agent` — RETIRED (410 Gone)

- Returns `410 Gone` for all requests. Use `/api/agent/paid` instead.

### `GET /api/agent/paid` — x402, 0.01 USDC

- Parameters: `network=mainnet`, `agentId` (positive integer)
- ERC-8004 data always resolved from Arc Mainnet regardless of payment network.
- Payment via Circle Gateway Nanopayments, x402 Version 2.
- **Accepted payment networks (payer's choice):**
  - Arc Mainnet — `eip155:5042` — USDC `0x3600000000000000000000000000000000000000`
  - Base Mainnet — `eip155:8453` — USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  - Arbitrum One — `eip155:42161` — USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- GatewayWallet verifyingContract: `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` (same on all three networks)
- Amount: `10000` units (0.01 USDC, 6 decimals)
- Seller address: configured via `SELLER_ADDRESS` environment variable
- No CDN cache (`Cache-Control: no-store`)

### `GET /api/openapi.json`

- Returns the OpenAPI 3.1 spec. Cached 1h CDN.

---

## Environment Variables

| Variable         | Required | Description                                      |
|------------------|----------|--------------------------------------------------|
| `SELLER_ADDRESS` | Yes (paid endpoint) | EVM address that receives x402 USDC payments |

---

## Foundry / Contracts

The imported registry contracts in `contracts/imported/` are read-only reference copies of the live ERC-8004 registry contracts (IdentityRegistry, ReputationRegistry, ValidationRegistry). They are not deployed from this repo.

Build fixes applied:
- `remappings.txt`: added `@openzeppelin/contracts-upgradeable/` remapping to the local copy under `contracts/imported/`
- `foundry.toml`: added `via_ir = true` to resolve stack-too-deep in `ReputationRegistryUpgradeable.sol`

---

## To Run

```bash
bun install
bun run dev        # frontend dev server on :5173
bun run check      # lint + typecheck
bun run contracts:build  # forge build
```
