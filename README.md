# Arc ERC-8004 Explorer

A read-only explorer and API for discovering and inspecting ERC-8004 agents on Arc.

**Live Explorer:** https://www.arcagents.app/

[Check the current Circle agent-readiness score](https://agents.circle.com/sell/score?url=www.arcagents.app)

## Overview

**Arc ERC-8004 Explorer** provides two ways to access ERC-8004 agent data:

* **Free manual Explorer** for people
* **Paid API** for AI agents, bots, automated workflows, and programmatic integrations

The Explorer supports ERC-8004 agent discovery and inspection on **Arc Mainnet** and **Arc Testnet**.

The paid API uses **x402 Version 2** (`exact` scheme) with the **Ultravioleta DAO facilitator** (`https://facilitator.ultravioletadao.xyz`) for machine-to-machine USDC payments. No facilitator account or API key is needed.

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

API access costs **$0.002 per successful request** (2000 atomic USDC units) and uses x402 payments verified and settled by the Ultravioleta DAO facilitator.

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
* Ultravioleta DAO x402 facilitator
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

Retrieve ERC-8004 agent identity and registration data from Arc Mainnet through x402 v2 payments.

The paid endpoint returns data from **Arc Mainnet only**; it does not provide Arc Testnet data (`network=testnet` is rejected with `400`). Testnet agents are free to inspect in the Explorer. Payment can be made on Arc Mainnet or Base Mainnet, which does not change the data network.

**Price:** `$0.002 / successful request` (2000 atomic USDC units, 6 decimals)

**Payment protocol:** x402 Version 2, `exact` scheme (EIP-3009 authorization)

**Payment facilitator:** Ultravioleta DAO (`https://facilitator.ultravioletadao.xyz`), verify and settle, no API key

USDC is paid directly to the seller address advertised in the payment requirements (`payTo`).

Example:

```text
GET https://www.arcagents.app/api/agent/paid?network=mainnet&agentId=15
```

The canonical domain is `https://www.arcagents.app`, and it is also the x402 **payment resource URL** published in the `402` challenge (`resource.url`): `https://www.arcagents.app/api/agent/paid`. Call and pay that URL exactly as written; a buyer that binds an `X-UVD-Purchase` purchase context to a different URL is refused with `400 receipt_context_mismatch`.

An unpaid request returns `402 Payment Required` with the available x402 payment requirements, including Bazaar discovery metadata (`extensions.bazaar`).

### Payment Networks

The endpoint advertises two payment networks:

| Payment network | CAIP-2        | USDC                                         | EIP-712 domain (name / version) |
| --------------- | ------------- | -------------------------------------------- | ------------------------------- |
| Arc Mainnet     | `eip155:5042` | `0x3600000000000000000000000000000000000000` | `USDC` / `2`                    |
| Base Mainnet    | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `USD Coin` / `2`                |

**Important:** ERC-8004 data is always resolved from **Arc Mainnet**. Base Mainnet is a payment network only. The EIP-712 domain name differs per network, so use `accepts[].extra` from the chosen entry when signing.

### Payment Availability

Arc Mainnet (`eip155:5042`) and Base Mainnet (`eip155:8453`) are both listed by the Ultravioleta DAO facilitator as supported for the x402 v2 `exact` scheme with USDC (see `https://facilitator.ultravioletadao.xyz/supported`).

Live settlement through this endpoint is pending production verification.

Payment verification, settlement, idempotency, replay protection and the safe retries are done by the Ultravioleta DAO facilitator, through the official SDK (`uvd-x402-sdk` 2.114.0, `FacilitatorClient.verify()` then `.settle()`). This API only validates the request, resolves the agent between the two calls (so a missing agent is never charged), and releases data after a **confirmed** settlement: the facilitator reported success, a transaction hash is present, the SDK does not flag the result as pending or unknown, an attached receipt says `confirmed`, and it is not a replay of an earlier purchase.

| Situation | Response (SDK formats) |
| --- | --- |
| Settlement confirmed | `200` with the data and `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE`: `success`, `payer`, `transaction`, `network` plus the SDK's own fields (`transactionHash`, `receipt`, `paymentId`) |
| Payment malformed or not matching an accepted option | `402 payment_invalid` with a fresh challenge |
| Facilitator refuses the payment at verify | `402 { error: "Payment verification failed", reason }` with a fresh challenge |
| Verify reached no verdict (timeout, 502/503, rate limit after the SDK's retry) | `503 { error: "Payment verification unavailable", retryable: true }` with `Retry-After`; resend the same credential |
| Authorization already used, or admitted for another purchase | `409 { error: "Payment authorization already used" \| "Payment request conflict", retryable: false }` |
| Authorization in flight | `503` with `Retry-After`, `reason: authorization_in_flight` |
| Settlement result the SDK flags retryable (pending or unknown receipt, timeout or lost connection while settling, 429/503) | `503 { error: "Payment settlement unavailable", retryable: true }` with `Retry-After`; resend the same credential, never sign a new payment |
| Settlement failed or cannot be confirmed (including `settlement_unconfirmed`, no hash, an attached receipt that is not `confirmed`, or a `202 settlement_in_progress` without a pending receipt: the SDK sets `retryable` only from a receipt) | `500 { error: "Payment settlement failed", retryable: false, errorCode?, transaction?, paymentId? }` |
| Not enough time left to settle | `503` "You were not charged" with `Retry-After` |
| Bad `X-UVD-Purchase` | `400 { error: "receipt_context_mismatch" }` |

A settlement failure is never a new `402` challenge, because a new signature would be a second payment. Uncertain outcomes carry no `PAYMENT-RESPONSE`; a failure the facilitator itself states (`success: false` with an `errorReason`) carries one with `success: false`, `errorReason`, `payer`, an empty `transaction` (or the hash, if there is one) and `network`.

**Timeouts and retries.** The function runs under `maxDuration: 60`. The SDK retries only a refusal the facilitator proved it did not execute (429, or 503 with a pre-execution reason), sleeping `Retry-After` (at most 15 s), and never retries a timeout. Settings, with the worst case `(retries + 1) × timeout + retries × 15 s`:

* verify: `timeout` 5 s, `retries` 1: at most 25 s
* settle: `timeout` 20 s, `retries` 0: at most 20 s
* 25 s + 12 s (agent lookup allowance) + 20 s = 57 s, which leaves a 3 s margin. Settlement is not started after 37 s have elapsed.
* The timeout is set explicitly, because the SDK would otherwise give Base a 90 s settle timeout.

One caveat the SDK does not expose: its timer stops when the response headers arrive, so a facilitator that stalled the body is cut off only by the platform limit.

#### Recovering a purchase after a lost or uncertain response

The facilitator hands an admitted payment's original answer back only to the request that admitted it: the same `X-UVD-Purchase` capability or the same `Idempotency-Key`. Holding the signed payment is not enough (it is public once it is on chain), so recovery needs a secret the buyer keeps:

- The **buyer** creates a random `purchaseId` and a 256-bit `accessToken`, persists them before the first paid request, and sends them as `X-UVD-Purchase` (base64 JSON bound to the method, the full URL and the body hash) with the signed payment. The Ultravioleta SDK's `fetchWithReceipt` does this.
- The **API** checks the header with the SDK's `validatePurchaseContext` against the real request (method `GET`, full public URL including `network` and `agentId`, empty body) and forwards it unchanged to `/verify` and `/settle` with one fresh `Idempotency-Key`. That same URL is sent as the payment resource. A context for another agent or network is refused before any facilitator call.
- After a `503` or a lost response, the buyer resends the identical request with the same signed payment and the same `X-UVD-Purchase`: the facilitator returns the original settlement and nothing is settled twice.
- A request **without** a purchase context cannot be recovered across requests: a stored answer reached without one is treated as "already used" (`409`) and no data is released.

The server keeps no payment state of its own. Clients built for the previous Circle Gateway batched scheme are no longer supported; use a standard x402 v2 `exact` (EIP-3009) client. The stock x402 client only signs assets it knows, so a buyer on Arc must explicitly allow the Arc USDC contract.

### Configuration

The paid endpoint reads one server environment variable:

* `SELLER_ADDRESS`: EVM address that receives the USDC payments

The facilitator needs no API key, so none is configured or sent.

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

An earlier version of the paid API (using Circle Gateway) was reported as 100/100 and runtime-verified. The payment integration has since moved to the Ultravioleta DAO facilitator, so that result is historical. The score for the current version has not been re-verified; check the link above for the current status.

## API Payment Flow

1. An AI agent requests the paid endpoint.
2. The API returns `402 Payment Required`.
3. The response exposes the available payment requirements.
4. The agent provides a valid x402 payment payload (`PAYMENT-SIGNATURE` header).
5. The Ultravioleta DAO facilitator verifies the payment (no funds move).
6. The API resolves the requested ERC-8004 agent from Arc Mainnet. A missing agent is not charged.
7. The facilitator settles the payment (`FacilitatorClient.settle()`), with the explicit timeout and retry settings above.
8. Only after a confirmed settlement (success, a transaction hash, not pending or unknown, not an unbound replay) the API returns the agent data as JSON with `PAYMENT-RESPONSE`.

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

The `x-payment-info` block of the paid operation (fixed price `0.002` USD, protocol `x402`) matches the `402` challenge, and its `servers` list the payment resource host (`www`) first so it equals the challenge's `resource.url`.

## Discovery

The paid endpoint publishes Bazaar discovery metadata (`extensions.bazaar`: the `GET` input with `network` and `agentId`, a real output example, and JSON Schemas) in its `PAYMENT-REQUIRED` challenge, together with the service name, description, tags and icon in `resource`. Listings:

* Ultravioleta DAO Bazaar: https://facilitator.ultravioletadao.xyz/bazaar?q=www.arcagents.app
* x402 Bazaar: https://x402-bazaar.com/resources/6af36d3129802b0f3634caf5

These are third-party catalogues. The x402 Bazaar page lists this resource (price $0.002 USDC, Arc 5042 and Base 8453, indexed by Ultravioleta DAO) at the time of writing. The catalogue entries are copied from the `402` challenge, so a changed description or schema only appears there after the listing is refreshed or re-indexed. A listing is not a guarantee of availability, ranking or buyer compatibility, and **it does not prove that a payment through Ultravioleta DAO has been completed end to end**: that is still pending production verification (see Payment Availability).

## Tech Stack

* React
* TypeScript
* Vite
* wagmi
* viem
* CSS
* ERC-8004
* Ultravioleta DAO x402 facilitator (official `uvd-x402-sdk` 2.114.0 for the protocol building blocks)
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

https://www.arcagents.app/

Paid API (x402 payment resource URL, as published in the `402` challenge):

https://www.arcagents.app/api/agent/paid

## Releases

Version history:

https://github.com/Nomad07/arc-erc8004-explorer/releases

Current release: **v1.1.3**

## Status

**Live**

Arc ERC-8004 Explorer is live on Arc Mainnet and Arc Testnet.

The manual Explorer is free to use.

The paid API endpoint is deployed for AI agents, bots, automated workflows, and programmatic integrations and returns x402 payment challenges. A completed live settlement through the Ultravioleta DAO facilitator has not been verified in production yet.

See Circle's agent-readiness page (linked above) for the current readiness status of the paid API.

## License

MIT
