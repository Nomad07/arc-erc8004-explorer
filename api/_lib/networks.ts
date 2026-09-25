/**
 * Shared network configuration for the Arc ERC-8004 Explorer API.
 * Values must stay in sync with NETWORK_CONFIGS in src/components/AgentDashboard.tsx.
 * arc-studio-allow-onchain-literal
 */

export interface NetworkConfig {
  label: string
  networkKey: 'mainnet' | 'testnet'
  chainId: number
  rpcUrl: string
  explorerBase: string
  identityRegistry:   `0x${string}`
  reputationRegistry: `0x${string}`
  validationRegistry: `0x${string}` | null
}

export const NETWORK_CONFIGS: Record<'mainnet' | 'testnet', NetworkConfig> = {
  mainnet: {
    label:              'Arc Mainnet',
    networkKey:         'mainnet',
    chainId:            5042,
    rpcUrl:             'https://rpc.mainnet.arc.io', // arc-studio-allow-onchain-literal
    explorerBase:       'https://explorer.arc.io',
    identityRegistry:   '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', // arc-studio-allow-onchain-literal
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63', // arc-studio-allow-onchain-literal
    validationRegistry: null,
  },
  testnet: {
    label:              'Arc Testnet',
    networkKey:         'testnet',
    chainId:            5042002,
    rpcUrl:             'https://rpc.testnet.arc.io', // arc-studio-allow-onchain-literal
    explorerBase:       'https://explorer.testnet.arc.io',
    identityRegistry:   '0x8004A818BFB912233c491871b3d84c89A494BD9e', // arc-studio-allow-onchain-literal
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713', // arc-studio-allow-onchain-literal
    validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272', // arc-studio-allow-onchain-literal
  },
}

// ─── ABIs (read-only subset, identical to AgentDashboard.tsx) ─────────────────

export const identityAbi = [
  { type: 'function', name: 'ownerOf',        stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'getAgentWallet',  stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'tokenURI',        stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string'  }] },
] as const

export const reputationAbi = [
  { type: 'function', name: 'getClients', stateMutability: 'view',
    inputs:  [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }] },
  { type: 'function', name: 'getSummary', stateMutability: 'view',
    inputs: [
      { name: 'agentId',         type: 'uint256'   },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1',            type: 'string'    },
      { name: 'tag2',            type: 'string'    },
    ],
    outputs: [
      { name: 'count',                type: 'uint64'  },
      { name: 'summaryValue',         type: 'int128'  },
      { name: 'summaryValueDecimals', type: 'uint8'   },
    ] },
  { type: 'function', name: 'readAllFeedback', stateMutability: 'view',
    inputs: [
      { name: 'agentId',         type: 'uint256'   },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1',            type: 'string'    },
      { name: 'tag2',            type: 'string'    },
      { name: 'includeRevoked',  type: 'bool'      },
    ],
    outputs: [
      { name: 'clients',         type: 'address[]' },
      { name: 'feedbackIndexes', type: 'uint64[]'  },
      { name: 'values',          type: 'int128[]'  },
      { name: 'valueDecimals',   type: 'uint8[]'   },
      { name: 'tag1s',           type: 'string[]'  },
      { name: 'tag2s',           type: 'string[]'  },
      { name: 'revokedStatuses', type: 'bool[]'    },
    ] },
] as const

export const validationAbi = [
  { type: 'function', name: 'getAgentValidations', stateMutability: 'view',
    inputs:  [{ name: 'agentId',     type: 'uint256'  }],
    outputs: [{ name: 'requestHashes', type: 'bytes32[]' }] },
  { type: 'function', name: 'getValidationStatus', stateMutability: 'view',
    inputs:  [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId',          type: 'uint256' },
      { name: 'response',         type: 'uint8'   },
      { name: 'responseHash',     type: 'bytes32' },
      { name: 'tag',              type: 'string'  },
      { name: 'lastUpdate',       type: 'uint256' },
    ] },
] as const
