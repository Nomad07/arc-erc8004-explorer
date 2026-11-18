/**
 * The documentation pages (/docs and /docs/mcp) are plain hand-written TSX. This test only checks that the facts that can drift
 * (price, endpoint, networks, USDC addresses, facilitator, sample response) still match api/_lib/x402-config.ts, and that the
 * pages are routed, listed in the sitemap and linked from the Explorer. No documentation is generated.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DISCOVERY_OUTPUT_EXAMPLE,
  FACILITATOR_BASE_URL,
  PAYMENT_NETWORKS,
  PRICE_ATOMIC,
  PRICE_USD,
  RESOURCE_URL,
} from '../../_lib/x402-config'

const root = resolve(import.meta.dir, '../../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

const apiDocs = read('src/docs/ApiDocs.tsx')
const mcpDocs = read('src/docs/McpDocs.tsx')

describe('documentation matches the payment configuration', () => {
  it('states the price and the endpoint', () => {
    expect(apiDocs).toContain(`$${PRICE_USD}`)
    expect(apiDocs).toContain(`<C>${PRICE_ATOMIC}</C>`)
    expect(apiDocs).toContain(`GET ${RESOURCE_URL}`)
    expect(apiDocs).toContain(`"url": "${RESOURCE_URL}"`)
    expect(mcpDocs).toContain(`$${PRICE_USD}`)
    expect(mcpDocs).toContain(`${PRICE_ATOMIC} atomic units`)
  })

  it('lists every payment network with its CAIP-2 id, USDC address and EIP-712 domain', () => {
    expect(PAYMENT_NETWORKS.length).toBe(2)
    for (const n of PAYMENT_NETWORKS) {
      for (const page of [apiDocs, mcpDocs]) {
        expect(page).toContain(n.caip2)
        expect(page).toContain(n.asset)
        expect(page).toContain(n.name)
      }
      expect(apiDocs).toContain(`"name": "${n.domainName}", "version": "${n.domainVersion}"`)
      expect(apiDocs).toContain(`name ${n.domainName}, version ${n.domainVersion}`)
    }
    // Only the two supported payment networks appear as CAIP-2 ids.
    const found = new Set([...apiDocs.matchAll(/eip155:\d+/g)].map(m => m[0]))
    expect([...found].sort()).toEqual(PAYMENT_NETWORKS.map(n => n.caip2).sort())
  })

  it('names the facilitator', () => {
    expect(apiDocs).toContain(FACILITATOR_BASE_URL)
    expect(mcpDocs).toContain(FACILITATOR_BASE_URL)
  })

  it('shows the real agent 15 response exactly as the API example defines it', () => {
    for (const page of [apiDocs, mcpDocs]) {
      expect(page).toContain(JSON.stringify(DISCOVERY_OUTPUT_EXAMPLE, null, 2))
    }
  })

  it('documents the Arc Mainnet-only data limitation and never offers testnet data on the paid API', () => {
    expect(apiDocs).toContain('Arc Mainnet only')
    expect(apiDocs).toMatch(/testnet.*return 400/)
    expect(mcpDocs).toMatch(/Arc Testnet data.*not available/)
  })
})

describe('documentation is routed, listed and linked', () => {
  it('routes /docs and /docs/mcp before the Explorer', () => {
    const app = read('src/App.tsx')
    expect(app).toContain("path === '/docs'")
    expect(app).toContain("path === '/docs/mcp'")
    expect(app).toContain('<AgentDashboard />')
  })

  it('lists both pages in the sitemap on the canonical www host', () => {
    const sitemap = read('public/sitemap.xml')
    expect(sitemap).toContain('<loc>https://www.arcagents.app/docs</loc>')
    expect(sitemap).toContain('<loc>https://www.arcagents.app/docs/mcp</loc>')
  })

  it('sets page-specific metadata', () => {
    const layout = read('src/docs/DocsLayout.tsx')
    for (const tag of ['document.title', 'meta[name="description"]', 'link[rel="canonical"]', 'og:url']) expect(layout).toContain(tag)
    expect(layout).toContain("const SITE = 'https://www.arcagents.app'")
  })

  it('keeps the Explorer header Docs link and the homepage MCP install command untouched', () => {
    const dashboard = read('src/components/AgentDashboard.tsx')
    expect(dashboard).toContain('href="/docs"')
    expect(dashboard).toContain("const MCP_INSTALL_COMMAND = 'npx -y arcagents-mcp@1.0.1'")
    expect(mcpDocs).toContain('const INSTALL_COMMAND = `npx -y arcagents-mcp@1.0.1`')
  })

  it('documents all nine MCP clients', () => {
    for (const id of ['claude-desktop', 'cursor', 'vscode', 'claude-code', 'cline', 'gemini-cli', 'codex', 'zed', 'mcp-inspector']) {
      expect(mcpDocs).toContain(`id: '${id}'`)
      expect(mcpDocs).toContain(`<Sub id="${id}"`)
    }
  })
})
