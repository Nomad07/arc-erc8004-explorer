# Arc ERC-8004 Explorer

An explorer for discovering and inspecting ERC-8004 agents on Arc Mainnet and Arc Testnet, with a paid x402 API for machine/AI access.

**Live:** https://www.arcagents.app/

---

## What This App Does

**Arc ERC-8004 Explorer** lets users and agents look up ERC-8004 agents by ID on Arc Mainnet or Arc Testnet. It displays identity (owner, agent wallet, metadata URI), reputation (clients, feedback, aggregate score), and validation data, all read live from the onchain registries.

No wallet connection is required for the human Explorer. The paid API endpoint accepts x402 v2 USDC payments verified and settled by the Ultravioleta DAO facilitator (no API key).

---

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, wagmi v2, viem v2, ConnectKit
- **API:** Vercel serverless functions (TypeScript), viem public clients
- **Contracts (imported, read-only):** Solidity 0.8.28, Foundry — sources in `contracts/imported/`, build with `bun run contracts:build`, test with `bun run contracts:test`
- **Payment:** x402 Version 2 `exact` (EIP-3009), Ultravioleta DAO facilitator (`https://facilitator.ultravioletadao.xyz`), `@x402/core` / `@x402/evm` / `@x402/extensions` 2.27.0
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
- `api/_lib/x402-facilitator.ts` — the timeout/retry settings for the two official `FacilitatorClient`s and the adapters from @x402/core objects to the SDK's types (no protocol logic)
- `api/_lib/x402-config.ts` — price, payment networks, facilitator URL, Bazaar metadata
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

### `GET /api/agent/paid` — x402, 0.002 USDC

- Parameters: `network=mainnet`, `agentId` (positive integer)
- ERC-8004 data always resolved from Arc Mainnet regardless of payment network.
- Payment: x402 Version 2 `exact`, verified and settled by the Ultravioleta DAO facilitator (`https://facilitator.ultravioletadao.xyz`, no account, API key or stack key; keep `UVD_STACK_KEY` unset) through the OFFICIAL `uvd-x402-sdk` 2.114.0: `FacilitatorClient.verify()` then `.settle()`, `validatePurchaseContext`, `createIdempotencyKey`, `buildPaymentConflictResponse`, `buildUnavailableResponse`, `mergePaymentResponseHeaders`. Ultravioleta owns verification, settlement, idempotency, replay protection, its safe retries and error classification; this API owns request validation, the 402 challenge and Bazaar metadata, the agent lookup (verify -> resolve -> settle; a missing agent is never charged) and releasing data only after a confirmed settlement (success + transaction hash + SDK result not pending/unknown + an attached receipt `confirmed` + not an unbound replay; `refuseUnboundReplay` is mirrored line for line because the SDK does not export it). Responses use the SDK's formats; a settlement failure is never a 402. One fresh `Idempotency-Key` per request, shared by verify and settle; a valid buyer `X-UVD-Purchase` is forwarded unchanged and the real request URL is the payment resource. `PAYMENT-RESPONSE` is built with the SDK helper and also carries `transaction` (= `transactionHash`) for the established x402 contract. No ReplayStore, no custom transport, no custom retry loop: do not add them.
- Timeouts/retries (the SDK's `timeout` per attempt and `retries` extra attempts; the SDK retries only a refusal the facilitator proved it did not execute, sleeping Retry-After <= 15 s, never a timeout): verify 5 s x (1 retry) = 25 s worst case, settle 20 s x 0 retries = 20 s; 25 + 12 (lookup allowance) + 20 = 57 s inside `maxDuration: 60` with a 3 s margin; settlement is not started after 37 s elapsed (`SETTLE_START_DEADLINE_MS`). `timeout` must stay explicit (the SDK's default for Base is 90 s). See the calculation in `api/_lib/x402-facilitator.ts`.
- URLs: the canonical domain is `https://www.arcagents.app` everywhere (index.html, sitemap, robots, share links, OpenAPI, README). It is also the x402 payment resource URL (`RESOURCE_URL`: the 402 `resource.url`, the OpenAPI first server, the Bazaar listing key and the base the `X-UVD-Purchase` URL check uses). Do not reintroduce the bare `arcagents.app` in project-owned URLs; the only `www` query allowed inside an external URL is the Ultravioleta Bazaar search link.
- Discovery (third-party catalogues, not proof of a live payment): Ultravioleta Bazaar https://facilitator.ultravioletadao.xyz/bazaar?q=www.arcagents.app , x402 Bazaar https://x402-bazaar.com/resources/6af36d3129802b0f3634caf5. Bazaar metadata is registered in `api/agent/paid.ts` (`bazaarResourceServerExtension` + `declareDiscoveryExtension`) and appears in `extensions.bazaar` of every 402.
- Log redaction only strips Bearer tokens, API keys, 64-hex access tokens (no `0x`), 128+ hex signatures and the exact secret values of the call (purchase context, access token, payment signature). Transaction hashes and addresses are kept.
- **Accepted payment networks (payer's choice):**
  - Arc Mainnet — `eip155:5042` — USDC `0x3600000000000000000000000000000000000000` (EIP-712 domain `USDC` / `2`)
  - Base Mainnet — `eip155:8453` — USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (EIP-712 domain `USD Coin` / `2`)
- Amount: `2000` units (0.002 USDC, 6 decimals), paid directly to `SELLER_ADDRESS`
- Bazaar discovery extension in the 402 (`extensions.bazaar`); constants live in `api/_lib/x402-config.ts`
- Tests: `bun test api`. Production smoke test (you run it, own wallet): `scripts/smoke-x402.ts`
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
