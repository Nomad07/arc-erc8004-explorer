/**
 * GET /api/agent — DISABLED
 *
 * This endpoint has been retired. Use GET /api/agent/paid instead.
 * Returns 410 Gone for all requests.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  return res.status(410).json({
    error:   'gone',
    message: 'GET /api/agent has been retired. Use GET /api/agent/paid instead.',
    docs:    'https://arcagents.app/api/openapi.json',
  })
}
