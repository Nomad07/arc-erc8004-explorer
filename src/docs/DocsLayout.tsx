/**
 * Shell for the documentation pages: top navigation, desktop sidebar, compact mobile navigation,
 * scroll-spy and per-page metadata (title, description, canonical).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { T, getAccent } from '@/design'

const ACCENT = getAccent(true)
const SITE = 'https://www.arcagents.app'
const GITHUB = 'https://github.com/Nomad07/arc-erc8004-explorer'

export interface DocSectionRef { id: string; label: string; children?: Array<{ id: string; label: string }> }

export interface DocsPageProps {
  /** Which documentation page is shown. */
  page: 'api' | 'mcp'
  title: string
  description: string
  /** Path used for the canonical URL, for example /docs/mcp. */
  path: string
  sections: DocSectionRef[]
  children: ReactNode
}

const PAGES = [
  { key: 'api' as const, href: '/docs', label: 'API' },
  { key: 'mcp' as const, href: '/docs/mcp', label: 'MCP Server' },
]

const TOP_LINKS: Array<{ label: string; href: string; page?: 'api' | 'mcp'; external?: boolean }> = [
  { label: 'Docs', href: '/docs', page: 'api' },
  { label: 'MCP', href: '/docs/mcp', page: 'mcp' },
  { label: 'OpenAPI', href: '/api/openapi.json', external: true },
  { label: 'GitHub', href: GITHUB, external: true },
  { label: 'Explorer', href: '/' },
]

/** Sets the page-specific head tags and restores the previous values when the page unmounts. */
function usePageMeta(title: string, description: string, path: string) {
  useEffect(() => {
    const url = `${SITE}${path}`
    const undo: Array<() => void> = []
    const prevTitle = document.title
    document.title = title
    undo.push(() => { document.title = prevTitle })
    const setAttr = (selector: string, create: () => HTMLElement, attr: string, value: string) => {
      let el = document.head.querySelector<HTMLElement>(selector)
      let created = false
      if (!el) { el = create(); document.head.appendChild(el); created = true }
      const prev = el.getAttribute(attr)
      el.setAttribute(attr, value)
      undo.push(() => { if (created) el?.remove(); else if (prev !== null) el?.setAttribute(attr, prev) })
    }
    const meta = (key: 'name' | 'property', name: string) => () => {
      const m = document.createElement('meta'); m.setAttribute(key, name); return m
    }
    setAttr('meta[name="description"]', meta('name', 'description'), 'content', description)
    setAttr('meta[property="og:title"]', meta('property', 'og:title'), 'content', title)
    setAttr('meta[property="og:description"]', meta('property', 'og:description'), 'content', description)
    setAttr('meta[property="og:url"]', meta('property', 'og:url'), 'content', url)
    setAttr('meta[name="twitter:title"]', meta('name', 'twitter:title'), 'content', title)
    setAttr('meta[name="twitter:description"]', meta('name', 'twitter:description'), 'content', description)
    setAttr('link[rel="canonical"]', () => { const l = document.createElement('link'); l.rel = 'canonical'; return l }, 'href', url)
    return () => undo.reverse().forEach(fn => fn())
  }, [title, description, path])
}

/** Id of the heading currently nearest the top of the viewport. */
function useActiveSection(idList: string[]) {
  const key = idList.join('|')
  const [active, setActive] = useState<string>(idList[0] ?? '')
  useEffect(() => {
    const els = key.split('|').map(id => document.getElementById(id)).filter((e): e is HTMLElement => e !== null)
    if (els.length === 0) return
    const visible = new Map<string, number>()
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top)
        else visible.delete(e.target.id)
      }
      if (visible.size > 0) {
        const [first] = [...visible.entries()].sort((a, b) => a[1] - b[1])
        setActive(first[0])
      }
    }, { rootMargin: '-72px 0px -65% 0px', threshold: 0 })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [key])
  return active
}

function SectionList({ sections, active, onNavigate }: { sections: DocSectionRef[]; active: string; onNavigate?: () => void }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {sections.map(s => (
        <li key={s.id}>
          <a className={`adoc-side-link${active === s.id ? ' is-active' : ''}`} href={`#${s.id}`} onClick={onNavigate}>{s.label}</a>
          {s.children && (
            <ul style={{ listStyle: 'none', margin: '1px 0 4px', padding: '0 0 0 12px', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {s.children.map(c => (
                <li key={c.id}>
                  <a className={`adoc-side-link adoc-side-sub${active === c.id ? ' is-active' : ''}`} href={`#${c.id}`} onClick={onNavigate}>{c.label}</a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

const CSS = `
  .adoc-root { min-height: 100dvh; background: ${T.bg}; color: ${T.ink}; font-family: ${T.body}; }
  .adoc-top { position: sticky; top: 0; z-index: 40; background: ${T.bgNav}; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid ${T.border}; }
  .adoc-top-inner { max-width: 1120px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; }
  .adoc-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: ${T.ink}; flex-shrink: 0; }
  .adoc-brand img { width: 24px; height: 24px; border-radius: 6px; display: block; }
  .adoc-brand-name { font-family: ${T.display}; font-weight: 700; font-size: 16px; letter-spacing: -0.03em; white-space: nowrap; }
  .adoc-brand-tag { font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${ACCENT.color}; background: ${ACCENT.dim}; border: 1px solid ${ACCENT.border}; border-radius: 100px; padding: 2px 8px; }
  .adoc-nav { display: flex; align-items: center; gap: 4px; }
  .adoc-nav a { display: inline-flex; align-items: center; gap: 3px; padding: 7px 11px; border-radius: 8px; font-size: 13px; font-weight: 600; color: ${T.ink2}; text-decoration: none; white-space: nowrap; border: 1px solid transparent; }
  .adoc-nav a:hover { color: ${T.ink}; background: ${T.bgInner}; }
  .adoc-nav a.is-active { color: ${ACCENT.color}; background: ${ACCENT.dim}; border-color: ${ACCENT.border}; }
  .adoc-shell { max-width: 1120px; margin: 0 auto; padding: 28px 20px 72px; display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 48px; }
  .adoc-side { position: sticky; top: 84px; align-self: start; max-height: calc(100dvh - 104px); overflow-y: auto; padding-right: 4px; }
  .adoc-side-label { font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.ink3}; margin: 0 0 8px 10px; }
  .adoc-page-links { display: flex; flex-direction: column; gap: 2px; margin-bottom: 18px; }
  .adoc-page-links a { padding: 8px 10px; border-radius: 8px; font-size: 13.5px; font-weight: 600; color: ${T.ink2}; text-decoration: none; border: 1px solid transparent; }
  .adoc-page-links a:hover { color: ${T.ink}; background: ${T.bgInner}; }
  .adoc-page-links a.is-active { color: ${ACCENT.color}; background: ${ACCENT.dim}; border-color: ${ACCENT.border}; }
  .adoc-side-link { display: block; padding: 5px 10px; border-left: 2px solid ${T.border}; font-size: 13px; line-height: 1.4; color: ${T.ink3}; text-decoration: none; }
  .adoc-side-link:hover { color: ${T.ink}; }
  .adoc-side-link.is-active { color: ${ACCENT.color}; border-left-color: ${ACCENT.color}; }
  .adoc-side-sub { font-size: 12.5px; }
  .adoc-main { min-width: 0; max-width: 760px; }
  .adoc-kv-row { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center; }
  .adoc-mobile-toc { display: none; }
  .adoc-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .adoc-anchor { opacity: 0; transition: opacity 0.12s; }
  h2:hover .adoc-anchor, h3:hover .adoc-anchor, .adoc-anchor:focus-visible { opacity: 1; }
  .adoc-link:hover { text-decoration: underline !important; text-underline-offset: 3px; }
  .adoc-link:focus-visible, .adoc-nav a:focus-visible, .adoc-side-link:focus-visible, .adoc-page-links a:focus-visible,
  .adoc-copy:focus-visible, .adoc-brand:focus-visible, .adoc-code:focus-visible, .adoc-mobile-toc summary:focus-visible { outline: 2px solid rgba(59,167,240,0.45); outline-offset: 2px; border-radius: 6px; }
  .adoc-footer { border-top: 1px solid ${T.border}; padding-top: 18px; margin-top: 8px; font-size: 12.5px; color: ${T.ink3}; display: flex; flex-wrap: wrap; gap: 6px 18px; }
  .adoc-footer a { color: ${T.ink3}; text-decoration: none; }
  .adoc-footer a:hover { color: ${T.ink}; }
  @media (max-width: 959px) {
    .adoc-shell { grid-template-columns: minmax(0, 1fr); gap: 0; padding-top: 18px; }
    .adoc-side { display: none; }
    .adoc-mobile-toc { display: block; position: sticky; top: 56px; z-index: 30; margin: 0 -20px 22px; background: ${T.bgNav}; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid ${T.border}; }
    .adoc-mobile-toc summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 20px; font-size: 13px; font-weight: 600; color: ${T.ink}; min-height: 44px; }
    .adoc-mobile-toc summary::-webkit-details-marker { display: none; }
    .adoc-mobile-toc[open] summary { border-bottom: 1px solid ${T.border}; }
    .adoc-mobile-body { padding: 12px 20px 16px; max-height: 60dvh; overflow-y: auto; }
  }
  @media (max-width: 560px) {
    .adoc-kv-row { grid-template-columns: minmax(0, 1fr); align-items: stretch; }
    .adoc-kv-row > dt { padding-bottom: 4px !important; background: transparent !important; }
    .adoc-kv-row > dd { padding-top: 0 !important; }
  }
  @media (max-width: 640px) {
    .adoc-top-inner { flex-direction: column; align-items: stretch; gap: 0; padding: 8px 16px 0; }
    .adoc-nav { overflow-x: auto; margin: 0 -16px; padding: 4px 12px 8px; scrollbar-width: none; }
    .adoc-nav::-webkit-scrollbar { display: none; }
    .adoc-shell { padding-left: 16px; padding-right: 16px; }
    .adoc-mobile-toc { margin-left: -16px; margin-right: -16px; top: 98px; }
    .adoc-mobile-toc summary, .adoc-mobile-body { padding-left: 16px; padding-right: 16px; }
  }
`

export function DocsLayout({ page, title, description, path, sections, children }: DocsPageProps) {
  usePageMeta(title, description, path)
  const ids = sections.flatMap(s => [s.id, ...(s.children?.map(c => c.id) ?? [])])
  const active = useActiveSection(ids)
  const tocRef = useRef<HTMLDetailsElement>(null)
  const activeLabel = [...sections, ...sections.flatMap(s => s.children ?? [])].find(s => s.id === active)?.label ?? sections[0]?.label

  // A deep link such as /docs/mcp#claude-code: the target only exists after this page renders.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  return (
    <div className="adoc-root">
      <style>{CSS}</style>
      <header className="adoc-top">
        <div className="adoc-top-inner">
          <a className="adoc-brand" href="/docs" aria-label="Arc Agents documentation">
            <img src="/favicon.svg" alt="" width={24} height={24} />
            <span className="adoc-brand-name">Arc Agents</span>
            <span className="adoc-brand-tag">Docs</span>
          </a>
          <nav className="adoc-nav" aria-label="Documentation">
            {TOP_LINKS.map(l => (
              <a
                key={l.label} href={l.href}
                className={l.page === page ? 'is-active' : undefined}
                aria-current={l.page === page ? 'page' : undefined}
                {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {l.label}{l.external && <ArrowUpRight size={12} aria-hidden />}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="adoc-shell">
        <aside className="adoc-side" aria-label="Page navigation">
          <div className="adoc-side-label">Documentation</div>
          <div className="adoc-page-links">
            {PAGES.map(p => (
              <a key={p.key} href={p.href} className={p.key === page ? 'is-active' : undefined} aria-current={p.key === page ? 'page' : undefined}>{p.label}</a>
            ))}
          </div>
          <div className="adoc-side-label">On this page</div>
          <SectionList sections={sections} active={active} />
        </aside>

        <main className="adoc-main">
          <details className="adoc-mobile-toc" ref={tocRef}>
            <summary>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: T.ink3, fontWeight: 500 }}>On this page: </span>{activeLabel}
              </span>
              <span aria-hidden style={{ color: T.ink3, fontSize: 11 }}>▾</span>
            </summary>
            <div className="adoc-mobile-body">
              <SectionList sections={sections} active={active} onNavigate={() => tocRef.current?.removeAttribute('open')} />
            </div>
          </details>

          {children}

          <footer className="adoc-footer">
            <span>Arc Agents documentation describes the current product.</span>
            <a href="/">Explorer</a>
            <a href="/api/openapi.json" target="_blank" rel="noopener noreferrer">OpenAPI</a>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
          </footer>
        </main>
      </div>
    </div>
  )
}
