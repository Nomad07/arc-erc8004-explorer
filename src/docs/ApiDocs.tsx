/**
 * /docs: Explorer API documentation. Plain content, edited by hand when the product changes.
 * Facts here are checked against api/agent/paid.ts, api/_lib/x402-config.ts and api/openapi.json.ts.
 */
import { A, B, C, CodeBlock, Codes, DataTable, KeyValueTable, Note, P, PageHeader, Section, Sub, UL } from './primitives'
import type { DocSectionRef } from './DocsLayout'

export const API_DOCS_TITLE = 'API Documentation - Arc Agents'
export const API_DOCS_DESCRIPTION =
  'Arc Agents API documentation: retrieve ERC-8004 agent identity, metadata, reputation and validation data from Arc Mainnet with x402 v2 payments, $0.002 USDC per successful request.'

export const API_SECTIONS: DocSectionRef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'api-and-mcp', label: 'API and MCP' },
  { id: 'quick-start', label: 'Quick start' },
  { id: 'endpoint', label: 'Endpoint and parameters' },
  { id: 'payment', label: 'Payment' },
  { id: 'response', label: 'Response fields' },
  { id: 'example', label: 'Example response' },
  { id: 'errors', label: 'Errors' },
  { id: 'limitations', label: 'Limitations' },
]

const UNPAID_REQUEST = `curl -i "https://www.arcagents.app/api/agent/paid?network=mainnet&agentId=15"`

const CHALLENGE_EXCERPT = `{
  "x402Version": 2,
  "resource": {
    "url": "https://www.arcagents.app/api/agent/paid",
    "description": "Retrieve ERC-8004 agent identity and registration data from Arc Mainnet through x402 v2 payments.",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:5042",
      "asset": "0x3600000000000000000000000000000000000000",
      "amount": "2000",
      "payTo": "0x4cd95FD3F59E803e4Bc6b3E7D1E6Fc8f23859aB7",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "2000",
      "payTo": "0x4cd95FD3F59E803e4Bc6b3E7D1E6Fc8f23859aB7",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ],
  "extensions": { "bazaar": { "...": "discovery metadata" } }
}`

const PAID_REQUEST = `GET /api/agent/paid?network=mainnet&agentId=15 HTTP/1.1
Host: www.arcagents.app
PAYMENT-SIGNATURE: <base64 JSON x402 v2 payment payload>`

const PAID_RESPONSE = `HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
PAYMENT-RESPONSE: <base64 JSON settlement result>

{ ...agent data, see Response fields... }`

const SETTLEMENT_SHAPE = `{
  "success": true,
  "payer": "0x<payer address>",
  "transaction": "0x<settlement transaction hash>",
  "network": "eip155:8453"
}`

const EXAMPLE_15 = `{
  "agentId": 15,
  "network": "mainnet",
  "chainId": 5042,
  "identity": {
    "owner": "0x4cd95FD3F59E803e4Bc6b3E7D1E6Fc8f23859aB7",
    "agentWallet": "0x4cd95FD3F59E803e4Bc6b3E7D1E6Fc8f23859aB7",
    "metadataUri": "ipfs://bafkreie4vt7xo2zhnprnamcrkghkg4uhkms7knqz5doafivkk7ramnvexa",
    "registries": {
      "identity": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      "reputation": "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
      "validation": null
    }
  },
  "metadata": {
    "name": "Arc Agent ID",
    "description": "An experimental AI agent identity toolkit built with Python and ERC-8004 on Arc Mainnet.",
    "services": [
      {
        "name": "Arc Agent ID Toolkit",
        "endpoint": "https://github.com/Nomad07/arc-agent-id"
      }
    ]
  },
  "metadataError": null,
  "reputation": {
    "clientCount": 0,
    "feedbackCount": 0,
    "aggregateScore": null,
    "clients": [],
    "feedback": []
  },
  "validation": {
    "available": false,
    "reason": "Validation registry not deployed on this network",
    "requestCount": null,
    "requests": []
  },
  "links": {
    "explorer": "https://explorer.arc.io",
    "agentOnExplorer": "https://www.arcagents.app/agent/15?network=mainnet"
  },
  "fetchedAt": "2026-11-07T20:16:40.511Z"
}`

export function ApiDocs() {
  return (
    <>
      <PageHeader eyebrow="API documentation" title="Arc Agents API">
        <P>
          The Arc ERC-8004 Explorer API returns the identity, metadata, reputation and validation data of an ERC-8004 agent
          registered on Arc Mainnet. Each successful request costs <B>$0.002 in USDC</B>, paid with x402 v2 on Arc Mainnet or
          Base Mainnet. There are no API keys or subscriptions.
        </P>
      </PageHeader>

      <Section id="overview" title="Overview">
        <KeyValueTable rows={[
          ['Endpoint', <C key="e">GET https://www.arcagents.app/api/agent/paid</C>],
          ['Price', '$0.002 USDC per successful request (2000 atomic units, 6 decimals)'],
          ['Payment', 'x402 v2, scheme exact (EIP-3009), USDC on Arc Mainnet or Base Mainnet'],
          ['Facilitator', <A key="f" href="https://facilitator.ultravioletadao.xyz" external>Ultravioleta DAO</A>],
          ['Data network', 'Arc Mainnet only. Base is a payment network, not a data network.'],
          ['Format', 'JSON over HTTPS'],
          ['OpenAPI', <A key="o" href="/api/openapi.json" external>https://www.arcagents.app/api/openapi.json</A>],
        ]} />
        <P>
          The manual <A href="/">Explorer</A> is free and covers Arc Mainnet and Arc Testnet. This API is the paid interface for
          AI agents, bots and automated integrations.
        </P>
      </Section>

      <Section id="api-and-mcp" title="How the API and MCP relate">
        <P>
          Arc Agents is one ecosystem with two interfaces to the same data. The <B>Explorer API</B> is
          the HTTP endpoint documented on this page. <B>Arc Agents MCP</B> is a local MCP server
          that calls this same endpoint for an AI assistant: it exposes one tool, <C>get_agent_data</C>, and pays each request with
          your wallet. The data, price and payment networks are identical.
        </P>
        <P>
          Call the API directly if you have an x402 v2 client. Use <A href="/docs/mcp">Arc Agents MCP</A> if you work in an MCP client
          such as Claude Desktop, Cursor or VS Code.
        </P>
      </Section>

      <Section id="quick-start" title="Quick start">
        <P>
          One request flow, three steps. The paid endpoint settles the payment only after the agent was found, so a missing agent is never charged.
        </P>
        <Sub id="quick-start-challenge" title="1. Request without payment">
          <P>A request with no payment returns <C>402 Payment Required</C> with the payment requirements.</P>
          <CodeBlock lang="bash" title="Request" code={UNPAID_REQUEST} />
          <P>
            The requirements are in the <C>PAYMENT-REQUIRED</C> response header (base64 JSON) and repeated in the body. Decoded, they
            offer one option per payment network:
          </P>
          <CodeBlock lang="json" title="Decoded PAYMENT-REQUIRED (excerpt)" code={CHALLENGE_EXCERPT} />
        </Sub>
        <Sub id="quick-start-pay" title="2. Sign and resend">
          <P>
            Choose one entry of <C>accepts</C>, sign an EIP-3009 <C>transferWithAuthorization</C> for that USDC contract and amount (use
            that entry's <C>extra.name</C> and <C>extra.version</C> as the EIP-712 domain), build the x402 v2 payment payload, and send it
            base64 encoded in the <C>PAYMENT-SIGNATURE</C> header on the same GET request. Any x402 v2 client library can do this; see
            the <A href="https://docs.x402.org/" external>x402 documentation</A>.
          </P>
          <CodeBlock lang="http" title="Paid request" code={PAID_REQUEST} />
        </Sub>
        <Sub id="quick-start-result" title="3. Receive the data">
          <P>
            The facilitator verifies the payment, the API reads the agent, and the facilitator settles the payment. Only after a
            confirmed settlement does the API return <C>200</C> with the agent data and a <C>PAYMENT-RESPONSE</C> header.
          </P>
          <CodeBlock lang="http" title="Response" code={PAID_RESPONSE} />
          <P>
            The decoded <C>PAYMENT-RESPONSE</C> carries the settlement result; <C>transaction</C> is the on-chain transaction hash:
          </P>
          <CodeBlock lang="json" title="Decoded PAYMENT-RESPONSE (shape)" code={SETTLEMENT_SHAPE} />
        </Sub>
      </Section>

      <Section id="endpoint" title="Endpoint and parameters">
        <CodeBlock lang="http" title="Endpoint" code={`GET https://www.arcagents.app/api/agent/paid?network=mainnet&agentId={agentId}`} />
        <DataTable
          columns={['Name', 'In', 'Required', 'Description']}
          mono={[0]}
          rows={[
            ['network', 'query', 'yes', <>Must be <C>mainnet</C>. The endpoint resolves ERC-8004 data from Arc Mainnet only; <C>testnet</C> and any other value return 400.</>],
            ['agentId', 'query', 'yes', 'ERC-8004 agent token ID: a positive integer, for example 15.'],
            ['PAYMENT-SIGNATURE', 'header', 'to pay', 'Base64 JSON x402 v2 payment payload. Without it the endpoint answers 402 with the payment requirements.'],
            ['X-UVD-Purchase', 'header', 'no', <>Optional purchase context that lets a client recover a lost or pending result without paying again (see the Ultravioleta SDK <C>fetchWithReceipt</C>). It must match the exact request URL; otherwise the API returns 400 <C>receipt_context_mismatch</C>.</>],
          ]}
        />
        <P>
          Query parameters must not be repeated. Call and pay the canonical URL <C>https://www.arcagents.app/api/agent/paid</C> exactly
          as published in the 402 challenge (<C>resource.url</C>).
        </P>
      </Section>

      <Section id="payment" title="Payment">
        <P>
          Payment is x402 v2 with the <C>exact</C> scheme: you sign an EIP-3009 authorization and the facilitator submits the transfer
          to the seller address in <C>payTo</C>. Both networks cost the same.
        </P>
        <DataTable
          columns={['Payment network', 'CAIP-2', 'USDC', 'EIP-712 domain']}
          mono={[1, 2]}
          rows={[
            ['Arc Mainnet', 'eip155:5042', '0x3600000000000000000000000000000000000000', 'name USDC, version 2'],
            ['Base Mainnet', 'eip155:8453', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'name USD Coin, version 2'],
          ]}
        />
        <UL>
          <li>Price: <C>2000</C> atomic USDC units, which is $0.002.</li>
          <li>Authorization window: <C>maxTimeoutSeconds</C> is 60.</li>
          <li>Facilitator: <A href="https://facilitator.ultravioletadao.xyz" external>https://facilitator.ultravioletadao.xyz</A>, no account or key needed.</li>
          <li>The EIP-712 domain name differs per network, so always read it from the chosen <C>accepts[].extra</C>.</li>
        </UL>
      </Section>

      <Section id="response" title="Response fields">
        <P>A successful response is one JSON object.</P>
        <DataTable
          columns={['Field', 'Type', 'Description']}
          mono={[0, 1]}
          rows={[
            ['agentId', 'number', 'The requested agent ID.'],
            ['network', 'string', <>Always <C>mainnet</C>.</>],
            ['chainId', 'number', <>Chain ID of the data network: <C>5042</C> (Arc Mainnet).</>],
            ['identity.owner', 'string', 'Address that owns the agent in the Identity Registry.'],
            ['identity.agentWallet', 'string', "The agent's wallet address."],
            ['identity.metadataUri', 'string', 'Metadata URI of the agent (usually an ipfs:// URI).'],
            ['identity.registries', 'object', <><C>identity</C>, <C>reputation</C> and <C>validation</C> registry addresses. <C>validation</C> is <C>null</C> on Arc Mainnet.</>],
            ['metadata', 'object | null', <>Parsed metadata document: <C>name</C>, <C>description</C>, <C>services</C>, <C>active</C>, <C>x402Support</C> and any other keys the document contains. <C>null</C> if it could not be fetched.</>],
            ['metadataError', 'string | null', <>Why <C>metadata</C> is <C>null</C>, for example <C>ipfs_unavailable</C>; otherwise <C>null</C>.</>],
            ['reputation.clientCount', 'number', 'Number of distinct clients that gave feedback.'],
            ['reputation.feedbackCount', 'number', 'Number of feedback entries counted in the aggregate.'],
            ['reputation.aggregateScore', 'string | null', <>Aggregate score as a decimal string; <C>null</C> when there is no feedback.</>],
            ['reputation.clients', 'string[]', 'Addresses of the clients.'],
            ['reputation.feedback', 'object[]', <>Feedback entries: <C>client</C>, <C>feedbackIndex</C>, <C>value</C> (decimal string), <C>tag1</C>, <C>tag2</C> and <C>isRevoked</C>. Revoked entries are not listed.</>],
            ['validation.available', 'boolean', <><C>false</C> when the network has no Validation Registry (always the case on Arc Mainnet today).</>],
            ['validation.reason', 'string | null', <>Explanation when validation is unavailable, for example <C>Validation registry not deployed on this network</C>.</>],
            ['validation.requestCount', 'number | null', <>Number of validation requests; <C>null</C> when unavailable.</>],
            ['validation.requests', 'object[]', <>Validation requests: <C>requestHash</C>, <C>validatorAddress</C>, <C>response</C>, <C>responseHash</C>, <C>hasResponse</C>, <C>tag</C>, <C>lastUpdate</C>, <C>lastUpdateIso</C>.</>],
            ['links.explorer', 'string', 'Arc block explorer.'],
            ['links.agentOnExplorer', 'string', 'Link to this agent in the Arc Agents Explorer.'],
            ['fetchedAt', 'string', 'ISO 8601 time at which the data was read.'],
          ]}
        />
      </Section>

      <Section id="example" title="Example response">
        <Note title="Real response">
          This is the actual API response for agent 15, retrieved on 2026-11-07. Onchain data can change, so it is an example and not
          live data. Agent 15 has no feedback, and Arc Mainnet has no Validation Registry, so those sections are empty.
        </Note>
        <CodeBlock lang="json" title="Agent 15" code={EXAMPLE_15} maxHeight={460} />
      </Section>

      <Section id="errors" title="Errors">
        <P>
          Errors use the HTTP statuses below. Where the request was not settled, nothing is charged. A <C>402</C> includes a fresh{' '}
          <C>PAYMENT-REQUIRED</C> header.
        </P>
        <DataTable
          columns={['Status', 'error', 'Meaning']}
          mono={[0]}
          rows={[
            ['400', <Codes key="e400" values={['bad_request']} />, <>Missing, invalid or repeated <C>network</C> or <C>agentId</C>; <C>network=testnet</C>; or an <C>X-UVD-Purchase</C> that does not match the request (<C>receipt_context_mismatch</C>). Not charged.</>],
            ['402', <Codes key="e402" values={['payment_invalid', 'Payment verification failed']} />, 'No payment, a payment that does not match one of the accepted options, or a payment the facilitator refused. Not charged.'],
            ['404', <Codes key="e404" values={['not_found']} />, 'The agent ID does not exist on Arc Mainnet. Checked before settlement, so never charged.'],
            ['409', <Codes key="e409" values={['Payment authorization already used', 'Payment request conflict']} />, 'The authorization was already used or belongs to another request. No data is returned. Do not sign a new payment for it.'],
            ['500', <Codes key="e500" values={['Payment settlement failed']} />, <>Settlement failed or could not be confirmed. No data is returned. The body can include <C>transaction</C> and <C>paymentId</C>; check the transaction before paying again.</>],
            ['503', <Codes key="e503" values={['rpc_error', 'Payment verification unavailable', 'Payment settlement unavailable']} />, <>A temporary failure with no final result yet. <C>rpc_error</C> happens before settlement and is not charged. Other cases include a <C>Retry-After</C> header: resend the same request with the same signed payment instead of signing a new one.</>],
          ]}
        />
        <P>
          A failure is never answered with a new <C>402</C> payment challenge after settlement started, because signing again would be a
          second payment.
        </P>
      </Section>

      <Section id="limitations" title="Limitations">
        <UL>
          <li>One agent per request. There is no search, listing or bulk endpoint.</li>
          <li>Data comes from Arc Mainnet only. Arc Testnet is available in the free <A href="/">Explorer</A>, not through this API.</li>
          <li>Base Mainnet is a payment network only: no data is read from Base.</li>
          <li>Arc Mainnet has no Validation Registry, so <C>validation.available</C> is <C>false</C>.</li>
          <li>Metadata is fetched from the agent's metadata URI over IPFS gateways. If it cannot be fetched, the request still succeeds with <C>metadata: null</C> and a <C>metadataError</C>.</li>
          <li>If the Reputation Registry cannot be read, the response still succeeds with empty reputation data.</li>
          <li>Responses are not cached (<C>Cache-Control: no-store</C>). <C>fetchedAt</C> shows when the data was read.</li>
          <li>Payments use x402 v2 only. There is no free programmatic access.</li>
        </UL>
      </Section>
    </>
  )
}
