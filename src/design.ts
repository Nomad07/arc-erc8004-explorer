/**
 * Arc Agents design tokens, shared by the Explorer and the documentation pages.
 * (Moved here unchanged from AgentDashboard.tsx.)
 */

// Base palette
export const T = {
  // Backgrounds — graphite surfaces
  bg:        '#0b0c0e',
  bgNav:     'rgba(11,12,14,0.9)',
  bgCard:    '#111316',
  bgHero:    '#14161a',
  bgInner:   '#17191d',
  bgWell:    '#0e1013',

  // Borders
  border:    'rgba(255,255,255,0.08)',
  borderMid: 'rgba(255,255,255,0.12)',

  // Text
  ink:       '#ecedef',
  ink2:      '#a0a4ab',
  ink3:      '#7a7f87',
  ink4:      '#4d5159',

  // Semantic
  green:     '#59c98a',
  greenDim:  'rgba(89,201,138,0.09)',
  greenB:    'rgba(89,201,138,0.22)',
  red:       '#f87171',
  redDim:    'rgba(248,113,113,0.08)',
  redB:      'rgba(248,113,113,0.18)',

  // Fonts
  mono:    "'JetBrains Mono', 'Fira Mono', Menlo, monospace",
  display: "'Space Grotesk', sans-serif",
  body:    "'DM Sans', sans-serif",
}

// Network-aware accent — call once in AgentDashboard, thread down
export function getAccent(isMainnet: boolean) {
  return isMainnet
    ? { color: '#3ba7f0', dim: 'rgba(59,167,240,0.11)', border: 'rgba(59,167,240,0.28)', glow: 'rgba(59,167,240,0.06)' }
    : { color: '#8fa6c4', dim: 'rgba(143,166,196,0.10)', border: 'rgba(143,166,196,0.24)', glow: 'rgba(143,166,196,0.06)' }
}
