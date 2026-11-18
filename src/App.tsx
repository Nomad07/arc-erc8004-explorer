import { AgentDashboard } from './components/AgentDashboard'
import { DocsLayout } from './docs/DocsLayout'
import { ApiDocs, API_DOCS_DESCRIPTION, API_DOCS_TITLE, API_SECTIONS } from './docs/ApiDocs'
import { McpDocs, MCP_DOCS_DESCRIPTION, MCP_DOCS_TITLE, MCP_SECTIONS } from './docs/McpDocs'

export default function App() {
  // No router: the site has three kinds of path. Vercel serves index.html for all of them.
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/docs') {
    return (
      <DocsLayout page="api" title={API_DOCS_TITLE} description={API_DOCS_DESCRIPTION} path="/docs" sections={API_SECTIONS}>
        <ApiDocs />
      </DocsLayout>
    )
  }
  if (path === '/docs/mcp') {
    return (
      <DocsLayout page="mcp" title={MCP_DOCS_TITLE} description={MCP_DOCS_DESCRIPTION} path="/docs/mcp" sections={MCP_SECTIONS}>
        <McpDocs />
      </DocsLayout>
    )
  }
  return <AgentDashboard />
}
