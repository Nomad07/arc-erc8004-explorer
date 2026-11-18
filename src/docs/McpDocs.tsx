/**
 * /docs/mcp: Arc Agents MCP documentation. Plain content, edited by hand when the product changes.
 * Facts here are checked against the arcagents-mcp repository (README.md, src/index.ts, src/config.ts, src/api.ts).
 */
import { A, B, C, CodeBlock, DataTable, KeyValueTable, Note, P, PageHeader, Section, Sub, UL } from './primitives'
import type { DocSectionRef } from './DocsLayout'

export const MCP_DOCS_TITLE = 'MCP Server Documentation - Arc Agents'
export const MCP_DOCS_DESCRIPTION =
  'Arc Agents MCP documentation: give AI assistants ERC-8004 agent data from Arc Mainnet through the get_agent_data tool, paid with x402 v2 at $0.002 USDC per successful request.'

export const MCP_SECTIONS: DocSectionRef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'how-it-works', label: 'How it uses the API' },
  { id: 'install', label: 'Requirements and install' },
  {
    id: 'setup', label: 'Client setup',
    children: [
      { id: 'claude-desktop', label: 'Claude Desktop' },
      { id: 'cursor', label: 'Cursor' },
      { id: 'vscode', label: 'Visual Studio Code' },
      { id: 'claude-code', label: 'Claude Code' },
      { id: 'cline', label: 'Cline' },
      { id: 'gemini-cli', label: 'Gemini CLI' },
      { id: 'codex', label: 'OpenAI Codex' },
      { id: 'zed', label: 'Zed' },
      { id: 'mcp-inspector', label: 'MCP Inspector' },
    ],
  },
  { id: 'configuration', label: 'Environment variables' },
  { id: 'tool', label: 'get_agent_data' },
  { id: 'example', label: 'Usage example' },
  { id: 'payment', label: 'Payment' },
  { id: 'interrupted', label: 'Retries and interrupted payments' },
  { id: 'limitations', label: 'Limitations' },
]

const INSTALL_COMMAND = `npx -y arcagents-mcp@1.0.1`
const GLOBAL_INSTALL = `npm install -g arcagents-mcp@1.0.1`

const CLAUDE_DESKTOP = `{
  "mcpServers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp@1.0.1"],
      "env": {
        "EVM_PRIVATE_KEY": "YOUR_EVM_PRIVATE_KEY",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      }
    }
  }
}`

const CURSOR = CLAUDE_DESKTOP

const CURSOR_ENV_REF = `"EVM_PRIVATE_KEY": "\${env:EVM_PRIVATE_KEY}"`

const VSCODE = `{
  "mcpServers": {
    "arcagents": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "arcagents-mcp@1.0.1"],
      "env": {
        "EVM_PRIVATE_KEY": "\${EVM_PRIVATE_KEY}",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      },
      "tools": ["*"]
    }
  }
}`

const CLAUDE_CODE_CLI = `claude mcp add --transport stdio --scope user \\
  --env EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY \\
  --env ARCAGENTS_PAYMENT_NETWORK=arc \\
  arcagents -- npx -y arcagents-mcp@1.0.1`

const CLAUDE_CODE_PROJECT = `{
  "mcpServers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp@1.0.1"],
      "env": {
        "EVM_PRIVATE_KEY": "\${EVM_PRIVATE_KEY}",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      }
    }
  }
}`

const CLINE = `{
  "mcpServers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp@1.0.1"],
      "env": {
        "EVM_PRIVATE_KEY": "YOUR_EVM_PRIVATE_KEY",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}`

const GEMINI = `{
  "mcpServers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp@1.0.1"],
      "env": {
        "EVM_PRIVATE_KEY": "$EVM_PRIVATE_KEY",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      }
    }
  }
}`

const GEMINI_CLI = `gemini mcp add -s user -e EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY -e ARCAGENTS_PAYMENT_NETWORK=arc arcagents npx -- -y arcagents-mcp@1.0.1`

const CODEX = `[mcp_servers.arcagents]
command = "npx"
args = ["-y", "arcagents-mcp@1.0.1"]
startup_timeout_sec = 60
# Forward the key from your shell environment instead of writing it in this file:
env_vars = ["EVM_PRIVATE_KEY"]

[mcp_servers.arcagents.env]
ARCAGENTS_PAYMENT_NETWORK = "arc"`

const CODEX_CLI = `codex mcp add arcagents \\
  --env EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY \\
  --env ARCAGENTS_PAYMENT_NETWORK=arc \\
  -- npx -y arcagents-mcp@1.0.1`

const ZED = `{
  "context_servers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp@1.0.1"],
      "env": {
        "EVM_PRIVATE_KEY": "YOUR_EVM_PRIVATE_KEY",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      }
    }
  }
}`

const INSPECTOR = `npx @modelcontextprotocol/inspector \\
  -e EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY \\
  -e ARCAGENTS_PAYMENT_NETWORK=arc \\
  npx -y arcagents-mcp@1.0.1`

const INSPECTOR_LIST = `npx @modelcontextprotocol/inspector --cli \\
  -e EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY \\
  npx -y arcagents-mcp@1.0.1 --method tools/list`

const WINDOWS = `"command": "cmd",
"args": ["/c", "npx", "-y", "arcagents-mcp@1.0.1"]`

const SETUP_NOTE = (
  <Note title="Use a dedicated wallet">
    Every client runs the same command: <C>npx -y arcagents-mcp@1.0.1</C>. Replace <C>YOUR_EVM_PRIVATE_KEY</C> with the key of a
    new wallet created only for this server and funded with a few cents of USDC. Never use your main wallet.
  </Note>
)

const EXAMPLE_CALL = `{
  "name": "get_agent_data",
  "arguments": { "agentId": 15 }
}`

const SETTLEMENT_BLOCK = `Payment: settled.
Transaction: 0x<settlement transaction hash>
Verify: <block explorer link>`

const API_ERROR_SHAPE = `{
  "httpStatus": 503,
  "retryAfter": "<seconds, when the API sends Retry-After>",
  "apiResponse": { "...": "the API's original error response" },
  "guidance": "<what happened and what the server will do next>"
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

export function McpDocs() {
  return (
    <>
      <PageHeader eyebrow="MCP documentation" title="Arc Agents MCP">
        <P>
          Arc Agents MCP brings ERC-8004 data on Arc directly to AI assistants through the <C>get_agent_data</C> tool. It is a standard
          Model Context Protocol server over stdio, published on npm, and it is optional: the <A href="/docs">Explorer API</A> works
          without it.
        </P>
      </PageHeader>

      <Section id="overview" title="Overview">
        <KeyValueTable rows={[
          ['Package', <A key="n" href="https://www.npmjs.com/package/arcagents-mcp" external>arcagents-mcp</A>],
          ['Tool', <C key="t">get_agent_data</C>],
          ['Transport', 'stdio (the client launches the server locally)'],
          ['Data', 'ERC-8004 agent data from Arc Mainnet'],
          ['Price', '$0.002 USDC per successful request'],
          ['Payment', 'x402 v2, exact scheme, on Arc Mainnet (default) or Base Mainnet'],
          ['Requires', 'Node.js 20 or newer and a dedicated wallet holding a little USDC'],
          ['Links', <span key="l"><A href="https://github.com/Nomad07/arcagents-mcp" external>GitHub</A> · <A href="https://www.npmjs.com/package/arcagents-mcp" external>npm</A> · <A href="https://registry.modelcontextprotocol.io/?q=arcagents-mcp" external>Official MCP Registry</A></span>],
        ]} />
      </Section>

      <Section id="how-it-works" title="How it uses the Explorer API">
        <P>
          Arc Agents is one ecosystem with two interfaces. The Explorer API serves the data; Arc Agents MCP exposes that API to AI
          assistants. For every tool call the server:
        </P>
        <UL>
          <li>requests <C>GET /api/agent/paid</C> on <C>www.arcagents.app</C> and receives the API's <C>402</C> payment challenge;</li>
          <li>checks the challenge, picks the option for your payment network and signs one EIP-3009 authorization with your wallet;</li>
          <li>resends the request with the payment and returns the API's JSON to the assistant.</li>
        </UL>
        <P>
          The result is the same data, price and payment networks as the <A href="/docs">API documentation</A> describes. Data is always
          read from Arc Mainnet; the payment network only decides where the USDC is paid.
        </P>
      </Section>

      <Section id="install" title="Requirements and install">
        <UL>
          <li>Node.js 20 or newer.</li>
          <li>A dedicated EVM wallet with a small USDC balance on Arc Mainnet, or on Base Mainnet if you choose Base.</li>
          <li>An MCP client that can launch local stdio servers.</li>
        </UL>
        <P>There is nothing to clone or build. Your client runs the published package with:</P>
        <CodeBlock lang="bash" title="Command" code={INSTALL_COMMAND} />
        <P>To install it globally instead, run the command below and use <C>arcagents-mcp</C> as the command, with no arguments:</P>
        <CodeBlock lang="bash" title="Global install" code={GLOBAL_INSTALL} />
      </Section>

      <Section id="setup" title="Client setup">
        {SETUP_NOTE}
        <P>
          Set <C>ARCAGENTS_PAYMENT_NETWORK</C> to <C>base</C> to pay on Base instead of Arc. Launched by hand, the server prints one
          readiness line on stderr and waits for a client. On Windows, if a client cannot start <C>npx</C> directly, use this instead of
          the <C>command</C> and <C>args</C> shown below:
        </P>
        <CodeBlock lang="json" title="Windows" code={WINDOWS} />

        <Sub id="claude-desktop" title="Claude Desktop">
          <P>
            Open <B>Settings, Developer, Edit Config</B>, or edit <C>claude_desktop_config.json</C> (macOS:{' '}
            <C>~/Library/Application Support/Claude/claude_desktop_config.json</C>, Windows: <C>%APPDATA%\Claude\claude_desktop_config.json</C>).
            Restart Claude Desktop completely afterwards.
          </P>
          <CodeBlock lang="json" title="claude_desktop_config.json" code={CLAUDE_DESKTOP} />
        </Sub>

        <Sub id="cursor" title="Cursor">
          <P>
            Edit <C>~/.cursor/mcp.json</C> (all projects) or <C>.cursor/mcp.json</C> (one project), or use{' '}
            <B>Settings, Tools &amp; MCP, Add Custom MCP Server</B>.
          </P>
          <CodeBlock lang="json" title="mcp.json" code={CURSOR} />
          <P>To keep the key out of the file, use the line below and export the variable before starting Cursor:</P>
          <CodeBlock lang="text" title="Key from the environment" code={CURSOR_ENV_REF} />
        </Sub>

        <Sub id="vscode" title="Visual Studio Code">
          <P>
            Current VS Code (Copilot) reads a top-level <C>mcpServers</C> object from <C>.mcp.json</C> in the workspace root or from{' '}
            <C>~/.copilot/mcp-config.json</C> for all workspaces. You can also add it in the UI with <B>Chat: Open Customizations, MCP
            Servers, Add Server, Command (stdio)</B>.
          </P>
          <CodeBlock lang="json" title=".mcp.json" code={VSCODE} />
          <P>
            <C>{'${EVM_PRIVATE_KEY}'}</C> is a reference read from the environment VS Code runs in: export the variable and start VS Code
            from that shell. A reference is safe to commit; a literal key is not. Use the braced form, because VS Code treats a bare{' '}
            <C>$NAME</C> as literal text.
          </P>
        </Sub>

        <Sub id="claude-code" title="Claude Code">
          <P>Add the server with one command (user scope makes it available in every project):</P>
          <CodeBlock lang="bash" title="Terminal" code={CLAUDE_CODE_CLI} />
          <P>Or share it with a team through a project <C>.mcp.json</C> that reads the key from each developer's environment:</P>
          <CodeBlock lang="json" title=".mcp.json" code={CLAUDE_CODE_PROJECT} />
          <P>Check it with <C>claude mcp list</C>, or <C>/mcp</C> inside Claude Code.</P>
        </Sub>

        <Sub id="cline" title="Cline">
          <P>
            In the Cline panel open <B>MCP Servers, Configure, Configure MCP Servers</B>. This opens <C>cline_mcp_settings.json</C>.
          </P>
          <CodeBlock lang="json" title="cline_mcp_settings.json" code={CLINE} />
          <P>Leave <C>autoApprove</C> empty so every paid call asks for your approval.</P>
        </Sub>

        <Sub id="gemini-cli" title="Gemini CLI">
          <P>Edit <C>~/.gemini/settings.json</C> (all projects) or <C>.gemini/settings.json</C> (one project):</P>
          <CodeBlock lang="json" title="settings.json" code={GEMINI} />
          <P>
            Gemini CLI expands <C>$EVM_PRIVATE_KEY</C> from your shell, so export it first. Or add the server from the command line; the{' '}
            <C>--</C> makes everything after it, including <C>-y</C>, arguments of <C>npx</C>:
          </P>
          <CodeBlock lang="bash" title="Terminal" code={GEMINI_CLI} />
          <P>Run <C>/mcp</C> inside Gemini CLI to confirm it is connected.</P>
        </Sub>

        <Sub id="codex" title="OpenAI Codex">
          <P>Edit <C>~/.codex/config.toml</C> (or <C>.codex/config.toml</C> in a trusted project):</P>
          <CodeBlock lang="toml" title="config.toml" code={CODEX} />
          <P>
            <C>startup_timeout_sec = 60</C> gives <C>npx</C> time to download the package the first time. Or use the CLI, then run{' '}
            <C>/mcp</C> in the Codex TUI to confirm:
          </P>
          <CodeBlock lang="bash" title="Terminal" code={CODEX_CLI} />
        </Sub>

        <Sub id="zed" title="Zed">
          <P>
            Open the settings file (<B>zed: open settings file</B>) and add a custom server under <C>context_servers</C>, or use{' '}
            <B>Settings, AI, MCP Servers, Add Server, Add Local Server</B>.
          </P>
          <CodeBlock lang="json" title="settings.json" code={ZED} />
          <P>In the Agent Panel settings check for a green indicator, then enable the tool in the profile you use.</P>
        </Sub>

        <Sub id="mcp-inspector" title="MCP Inspector">
          <P>
            <A href="https://github.com/modelcontextprotocol/inspector" external>MCP Inspector</A> is the quickest way to test the
            server and call the tool by hand. Pass the variables with <C>-e</C>: Inspector does not forward your shell environment.
          </P>
          <CodeBlock lang="bash" title="Terminal" code={INSPECTOR} />
          <P>
            Click <B>Connect</B>, then open <B>Tools, List Tools</B> to see <C>get_agent_data</C>. Running the tool makes a real $0.002
            payment. To list the tools without paying, use CLI mode:
          </P>
          <CodeBlock lang="bash" title="Terminal" code={INSPECTOR_LIST} />
        </Sub>

        <P>
          Any other application, assistant or agent that supports standard MCP stdio connections works the same way: launch{' '}
          <C>npx</C> with the arguments <C>-y arcagents-mcp@1.0.1</C> and pass <C>EVM_PRIVATE_KEY</C> in the process environment.
          Clients that only accept remote HTTP MCP URLs cannot use it.
        </P>
      </Section>

      <Section id="configuration" title="Environment variables">
        <DataTable
          columns={['Variable', 'Required', 'Default', 'Description']}
          mono={[0, 2]}
          rows={[
            ['EVM_PRIVATE_KEY', 'yes', '-', <>Private key (<C>0x</C> plus 64 hex characters) of the dedicated payment wallet.</>],
            ['ARCAGENTS_PAYMENT_NETWORK', 'no', 'arc', <>Payment network: <C>arc</C> or <C>base</C>. Any other value stops startup.</>],
            ['ARCAGENTS_MAX_PAYMENTS', 'no', '50', 'Maximum payments this server process may sign (integer 1 to 1000). At $0.002 each, the default caps a session at $0.10.'],
            ['ARCAGENTS_TIMEOUT_MS', 'no', '30000', 'Total timeout for one tool call, in milliseconds (1000 to 120000).'],
            ['ARCAGENTS_STATE_DIR', 'no', '~/.arcagents-mcp', 'Private directory where signed but unresolved payments are saved. Must be an absolute path that only your account can read.'],
          ]}
        />
        <P>MCP clients pass these through the <C>env</C> block of their server configuration; the server does not read a <C>.env</C> file.</P>
      </Section>

      <Section id="tool" title="The get_agent_data tool">
        <P>
          Returns ERC-8004 data from Arc Mainnet for one agent ID: identity and registration, parsed metadata, reputation and feedback,
          validation data, explorer links and the fetch timestamp. Each successful call is a paid request.
        </P>
        <DataTable
          columns={['Input', 'Type', 'Required', 'Description']}
          mono={[0, 1]}
          rows={[
            ['agentId', 'integer', 'yes', 'ERC-8004 agent token ID on Arc Mainnet: a positive integer, for example 15. Anything else is rejected before any request or payment is made.'],
          ]}
        />
        <P><B>Output.</B> The first text block is always the API's JSON response; the fields are described in the <A href="/docs#response">API documentation</A>. After a paid call the server adds a second block with the settlement transaction hash and an explorer link, when the API reports them.</P>
        <P><B>Errors.</B> An error from the API returns the HTTP status, the original API response and a guidance sentence. Problems before an API response (configuration, no connection) return <C>error</C>, <C>message</C> and <C>guidance</C>. The private key never appears in tool output or logs.</P>
        <CodeBlock lang="json" title="Error from the API (shape)" code={API_ERROR_SHAPE} />
      </Section>

      <Section id="example" title="Usage example">
        <P>Ask your assistant:</P>
        <CodeBlock lang="text" title="Prompt" code="Use the Arc Agents MCP server to get the ERC-8004 data for agent 15." />
        <P>The assistant calls the tool with:</P>
        <CodeBlock lang="json" title="Tool call" code={EXAMPLE_CALL} />
        <P>
          The first block of the result is the API response. Below is the real API response for agent 15 (retrieved 2026-11-07). Onchain
          data can change, so treat it as an example and not live data. Agent 15 has no feedback, and Arc Mainnet has no Validation Registry.
        </P>
        <CodeBlock lang="json" title="Result, block 1" code={EXAMPLE_15} maxHeight={420} />
        <P>The second block reports the payment:</P>
        <CodeBlock lang="text" title="Result, block 2 (format)" code={SETTLEMENT_BLOCK} />
      </Section>

      <Section id="payment" title="Payment">
        <DataTable
          columns={['', 'Arc Mainnet (default)', 'Base Mainnet']}
          mono={[1, 2]}
          rows={[
            ['CAIP-2 network', 'eip155:5042', 'eip155:8453'],
            ['Setting', 'arc', 'base'],
            ['USDC', '0x3600000000000000000000000000000000000000', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
            ['EIP-712 domain', 'USDC, version 2', 'USD Coin, version 2'],
          ]}
        />
        <UL>
          <li><B>Price:</B> $0.002 USDC per successful request (2000 atomic units).</li>
          <li><B>Protocol:</B> x402 v2, <C>exact</C> scheme (EIP-3009), with the <A href="https://github.com/UltravioletaDAO/uvd-x402-sdk-typescript" external>Ultravioleta SDK</A>.</li>
          <li><B>Facilitator:</B> <C>https://facilitator.ultravioletadao.xyz</C>, no API key. It submits the transfer, so you need no gas token.</li>
          <li><B>One network per run:</B> the server signs only for the network you selected and never switches networks after a failure.</li>
          <li><B>Safety checks:</B> it signs only when the challenge is <C>exact</C>, for the expected USDC contract and EIP-712 domain, for exactly 2000 units. The session cap (<C>ARCAGENTS_MAX_PAYMENTS</C>) is checked before anything is signed.</li>
        </UL>
        <P>ERC-8004 data is always read from Arc Mainnet. Base is a payment network only.</P>
      </Section>

      <Section id="interrupted" title="Retries and interrupted payments">
        <DataTable
          columns={['API status', 'What the server does']}
          mono={[0]}
          rows={[
            ['200', 'Returns the data and the transaction hash when reported.'],
            ['400', 'Returns the API error. No data is returned.'],
            ['404', 'Returns the API error. Not charged.'],
            ['402 (after paying)', 'Returns the API error. No automatic retry.'],
            ['409', 'Returns the API error. Does not sign a new payment.'],
            ['500', 'Returns the API error and any transaction hash. Does not sign a new payment.'],
            ['503', 'Returns the API error and Retry-After. Does not sign a new payment.'],
          ]}
        />
        <P>
          Before a signed payment is sent it is saved as one small private file per request, in <C>~/.arcagents-mcp</C> or{' '}
          <C>ARCAGENTS_STATE_DIR</C>. If a request ends without a final answer (a <C>503</C>, <C>500</C>, <C>409</C> or <C>429</C>, a
          timeout, a lost connection or an unreadable body), asking again for the same agent ID resends the identical payment and does
          not sign a new one, so you are not charged twice. The saved payment survives restarts and is removed once the API gives a
          final answer. Nothing is retried automatically, and <C>Retry-After</C> is reported to you, not waited on.
        </P>
        <UL>
          <li>If two MCP processes request the same agent at the same time, only one sends the payment; the other returns a temporary conflict and a later request reuses the saved payment.</li>
          <li>A <C>409</C> carries a reason: <C>authorization_already_settled</C> (already used, payment confirmed) or <C>receipt_request_conflict</C> (the authorization belongs to another request). Neither creates a new authorization.</li>
          <li>If the saved state cannot be read or written, nothing is signed or sent.</li>
        </UL>
        <Note title="State directory">
          The files contain signed authorizations. On macOS and Linux the server creates the directory with mode 0700 and files with 0600.
          On Windows protection comes from the folder's access rules, so a custom <C>ARCAGENTS_STATE_DIR</C> must be an absolute path that only
          your account can read.
        </Note>
      </Section>

      <Section id="limitations" title="Limitations">
        <UL>
          <li>Data covers Arc Mainnet agents only. Arc Testnet data, which the Explorer shows, is not available through the paid API or this server.</li>
          <li>Validation data depends on registry availability and may be absent.</li>
          <li>Agent activity is not available.</li>
          <li>One agent ID per call. There is no search, listing or bulk tool.</li>
          <li>Payments use x402 only.</li>
          <li>The server runs over stdio. Web-only chat apps that only accept remote HTTP MCP URLs cannot use it.</li>
        </UL>
      </Section>
    </>
  )
}
