/**
 * Building blocks for the Arc Agents documentation pages (/docs and /docs/mcp).
 * Plain presentational components on the shared design tokens; no data fetching.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Copy, Link as LinkIcon } from 'lucide-react'
import { T, getAccent } from '@/design'

const ACCENT = getAccent(true)

// ── text ──────────────────────────────────────────────────────────────────────

export const proseStyle: CSSProperties = {
  fontFamily: T.body, fontSize: 14.5, lineHeight: 1.7, color: T.ink2, margin: '0 0 14px',
}

export function P({ children }: { children: ReactNode }) {
  return <p style={proseStyle}>{children}</p>
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code style={{
      fontFamily: T.mono, fontSize: '0.86em', color: T.ink, background: T.bgWell,
      border: `1px solid ${T.border}`, borderRadius: 5, padding: '1px 5px', overflowWrap: 'anywhere',
    }}>{children}</code>
  )
}

/** Several code values stacked in one table cell. */
export function Codes({ values }: { values: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start', minWidth: 230 }}>
      {values.map(v => <C key={v}>{v}</C>)}
    </div>
  )
}

export function A({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  return (
    <a
      className="adoc-link" href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      style={{ color: ACCENT.color, fontWeight: 600, textDecoration: 'none' }}
    >{children}</a>
  )
}

export function UL({ children }: { children: ReactNode }) {
  return <ul style={{ ...proseStyle, paddingLeft: 22, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</ul>
}

/** Page title block: eyebrow, h1 and a short lead. */
export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ fontFamily: T.body, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: ACCENT.color, marginBottom: 10 }}>
        {eyebrow}
      </div>
      <h1 style={{ margin: '0 0 12px', fontFamily: T.display, fontSize: 'clamp(28px, 5vw, 38px)', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.1, color: T.ink }}>
        {title}
      </h1>
      {children}
    </div>
  )
}

/** Emphasised inline text. */
export function B({ children }: { children: ReactNode }) {
  return <strong style={{ color: T.ink, fontWeight: 600 }}>{children}</strong>
}

// ── sections with anchors ─────────────────────────────────────────────────────

function AnchorLink({ id }: { id: string }) {
  return (
    <a className="adoc-anchor" href={`#${id}`} aria-label="Link to this section" style={{ color: T.ink4, display: 'inline-flex' }}>
      <LinkIcon size={14} aria-hidden />
    </a>
  )
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 84, marginBottom: 44 }}>
      <h2 style={{
        display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px', paddingBottom: 10,
        borderBottom: `1px solid ${T.border}`,
        fontFamily: T.display, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.2, color: T.ink,
      }}>
        {title}<AnchorLink id={id} />
      </h2>
      {children}
    </section>
  )
}

export function Sub({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div id={id} style={{ scrollMarginTop: 84, margin: '28px 0 6px' }}>
      <h3 style={{
        display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px',
        fontFamily: T.display, fontSize: 16.5, fontWeight: 600, letterSpacing: '-0.02em', color: T.ink,
      }}>
        {title}<AnchorLink id={id} />
      </h3>
      {children}
    </div>
  )
}

// ── tables ────────────────────────────────────────────────────────────────────

const cellBase: CSSProperties = {
  padding: '10px 14px', textAlign: 'left', verticalAlign: 'top',
  fontFamily: T.body, fontSize: 13.5, lineHeight: 1.55, color: T.ink2,
  borderBottom: `1px solid ${T.border}`,
}

/** Label / value rows for the overview blocks. Stacks label above value on narrow screens (see DocsLayout CSS). */
export function KeyValueTable({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl style={{ margin: '0 0 18px', border: `1px solid ${T.border}`, borderRadius: 10, background: T.bgCard, overflow: 'hidden' }}>
      {rows.map(([k, v], i) => (
        <div key={k} className="adoc-kv-row" style={{ borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${T.border}` }}>
          <dt style={{
            margin: 0, padding: '11px 14px', background: T.bgWell, fontFamily: T.body, fontSize: 10.5, fontWeight: 700,
            letterSpacing: '0.09em', textTransform: 'uppercase', color: T.ink3,
          }}>{k}</dt>
          <dd style={{ margin: 0, padding: '10px 14px', minWidth: 0, fontFamily: T.body, fontSize: 13.5, lineHeight: 1.55, color: T.ink, overflowWrap: 'anywhere' }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Header row plus data rows. `mono` lists column indexes that hold code-like values. */
export function DataTable({ columns, rows, mono = [] }: { columns: string[]; rows: ReactNode[][]; mono?: number[] }) {
  return (
    <div className="adoc-scroll" style={{ border: `1px solid ${T.border}`, borderRadius: 10, background: T.bgCard, margin: '0 0 18px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c} style={{
                ...cellBase, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em',
                textTransform: 'uppercase', color: T.ink3, background: T.bgWell, whiteSpace: 'nowrap',
              }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  ...cellBase,
                  borderBottom: ri === rows.length - 1 ? 'none' : cellBase.borderBottom,
                  ...(mono.includes(ci) ? { fontFamily: T.mono, fontSize: 12, color: T.ink, overflowWrap: 'anywhere' as const } : {}),
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Note({ title, children, tone = 'info' }: { title?: string; children: ReactNode; tone?: 'info' | 'warn' }) {
  const warn = tone === 'warn'
  return (
    <div style={{
      margin: '0 0 18px', padding: '12px 16px', borderRadius: 10,
      background: warn ? T.redDim : ACCENT.dim, border: `1px solid ${warn ? T.redB : ACCENT.border}`,
    }}>
      {title && (
        <div style={{
          fontFamily: T.body, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
          color: warn ? T.red : ACCENT.color, marginBottom: 4,
        }}>{title}</div>
      )}
      <div style={{ ...proseStyle, margin: 0, fontSize: 13.5, color: T.ink2 }}>{children}</div>
    </div>
  )
}

// ── code blocks ───────────────────────────────────────────────────────────────

export type Lang = 'bash' | 'json' | 'http' | 'toml' | 'text'

const TOKEN_RE: Record<Exclude<Lang, 'text'>, RegExp> = {
  json: /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
  bash: /(#.*$)|("(?:\\.|[^"\\])*"|'[^']*')|(\s--?[A-Za-z][\w-]*)|(^\s*\$?\s*[A-Za-z][\w.-]*)/gm,
  http: /(^[A-Za-z][\w-]*)(:)|(^GET|^POST|^HTTP\/\d(?:\.\d)?)|(<[^>]+>)/gm,
  toml: /(#.*$)|(\[[^\]\n]+\])|("(?:\\.|[^"\\])*")|(^[A-Za-z_][\w-]*)(?=\s*=)/gm,
}

/** Small colour pass: enough to read a request, a config or a JSON document comfortably. */
export function highlight(code: string, lang: Lang): ReactNode[] {
  if (lang === 'text') return [code]
  const out: ReactNode[] = []
  const re = new RegExp(TOKEN_RE[lang].source, TOKEN_RE[lang].flags)
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  const push = (text: string, color?: string) => {
    if (text) out.push(color ? <span key={key++} style={{ color }}>{text}</span> : text)
  }
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) push(code.slice(last, m.index))
    const text = m[0]
    if (lang === 'json') {
      if (m[1] !== undefined) {
        if (m[2] !== undefined) { push(m[1], ACCENT.color); push(m[2], T.ink3) } else push(m[1], T.green)
      } else if (m[3] !== undefined) push(text, T.ink3)
      else push(text, T.ink)
    } else if (lang === 'bash') {
      if (m[1] !== undefined) push(text, T.ink4)
      else if (m[2] !== undefined) push(text, T.green)
      else if (m[3] !== undefined) push(text, ACCENT.color)
      else if (m.index === 0) push(text, T.green)
      else push(text)
    } else if (lang === 'http') {
      if (m[1] !== undefined) { push(m[1], ACCENT.color); push(m[2], T.ink3) }
      else if (m[3] !== undefined) push(text, T.green)
      else push(text, T.ink3)
    } else {
      if (m[1] !== undefined) push(text, T.ink4)
      else if (m[2] !== undefined) push(text, T.green)
      else if (m[3] !== undefined) push(text, T.green)
      else push(text, ACCENT.color)
    }
    last = m.index + text.length
    if (text.length === 0) re.lastIndex++
  }
  if (last < code.length) push(code.slice(last))
  return out
}

/** Copies text; falls back to execCommand where the Clipboard API is blocked (for example in an iframe). */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const settle = (next: 'copied' | 'failed') => {
    setState(next)
    setTimeout(() => setState('idle'), 1800)
  }
  const copy = () => {
    const fallback = () => {
      const ta = document.createElement('textarea')
      ta.value = value
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      let ok = false
      try { ok = document.execCommand('copy') } catch { ok = false }
      document.body.removeChild(ta)
      settle(ok ? 'copied' : 'failed')
    }
    if (navigator.clipboard) navigator.clipboard.writeText(value).then(() => settle('copied'), fallback)
    else fallback()
  }
  const copied = state === 'copied'
  return (
    <button
      type="button" onClick={copy} className="adoc-copy"
      aria-label={copied ? `${label}: copied` : `${label} code`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '0 11px', borderRadius: 7, cursor: 'pointer',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', fontFamily: T.body,
        background: copied ? T.greenDim : T.bgInner,
        border: `1px solid ${copied ? T.greenB : state === 'failed' ? T.redB : T.border}`,
        color: copied ? T.green : state === 'failed' ? T.red : ACCENT.color, transition: 'all 0.12s',
      }}
    >
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      <span aria-live="polite">{copied ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
    </button>
  )
}

export function CodeBlock({ code, lang = 'text', title, maxHeight }: { code: string; lang?: Lang; title?: string; maxHeight?: number }) {
  const trimmed = code.replace(/^\n+|\s+$/g, '')
  return (
    <div style={{ margin: '0 0 18px', borderRadius: 10, overflow: 'hidden', background: '#0a0b0d', border: `1px solid ${T.borderMid}` }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: '5px 8px 5px 14px', background: '#101215', borderBottom: `1px solid ${T.border}`,
      }}>
        <span style={{
          fontFamily: T.mono, fontSize: 11.5, fontWeight: 500, color: T.ink3,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title ?? lang}</span>
        <CopyButton value={trimmed} />
      </div>
      <pre className="adoc-code" tabIndex={0} style={{
        margin: 0, padding: '14px 16px', overflow: 'auto', maxHeight,
        fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre', color: T.ink2,
      }}>
        <code>{highlight(trimmed, lang)}</code>
      </pre>
    </div>
  )
}
