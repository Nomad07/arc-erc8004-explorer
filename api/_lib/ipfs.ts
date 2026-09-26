/** IPFS gateway fetch with timeout and fallback. Server-side version (8s timeout). */

const GATEWAYS = [
  'https://w3s.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
]

const TIMEOUT_MS = 8000

export function ipfsToHttp(uri: string, gatewayIndex = 0): string {
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice(7)
    return `${GATEWAYS[gatewayIndex % GATEWAYS.length]}${cid}`
  }
  return uri
}

export async function fetchIpfsJson(uri: string): Promise<{ data: unknown; error: null } | { data: null; error: string }> {
  if (!uri) return { data: null, error: 'empty_uri' }
  for (let i = 0; i < GATEWAYS.length; i++) {
    const url = ipfsToHttp(uri, i)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) continue
      const json = await res.json() as unknown
      return { data: json, error: null }
    } catch {
      // try next gateway
    }
  }
  return { data: null, error: 'ipfs_unavailable' }
}
