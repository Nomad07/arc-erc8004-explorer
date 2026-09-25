/** TypeScript types for Arc ERC-8004 Explorer API responses. */

export interface FeedbackRecord {
  client:         string
  feedbackIndex:  number
  value:          string   // formatted decimal
  tag1:           string | null
  tag2:           string | null
  isRevoked:      boolean
}

export interface ValidationRequest {
  requestHash:      string
  validatorAddress: string
  response:         number
  responseHash:     string
  hasResponse:      boolean
  tag:              string | null
  lastUpdate:       number   // unix timestamp
  lastUpdateIso:    string
}

export interface AgentMetadata {
  name:         string | null
  description:  string | null
  services:     Array<{ name?: string; endpoint?: string; version?: string }> | null
  active:       boolean | null
  x402Support:  boolean | null
  [key: string]: unknown
}

export interface AgentResponse {
  agentId:  number
  network:  'mainnet' | 'testnet'
  chainId:  number
  identity: {
    owner:       string
    agentWallet: string
    metadataUri: string
    registries: {
      identity:   string
      reputation: string
      validation: string | null
    }
  }
  metadata:      AgentMetadata | null
  metadataError: string | null
  reputation: {
    clientCount:    number
    feedbackCount:  number
    aggregateScore: string | null
    clients:        string[]
    feedback:       FeedbackRecord[]
  }
  validation: {
    available:    boolean
    reason:       string | null
    requestCount: number | null
    requests:     ValidationRequest[]
  }
  links: {
    explorer:        string
    agentOnExplorer: string
  }
  fetchedAt: string
}

export interface ErrorResponse {
  error:   string
  message: string
  agentId?: number
  network?: string
  chainId?: number
}
