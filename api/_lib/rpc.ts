/** viem public clients for Arc Mainnet and Arc Testnet. arc-studio-allow-onchain-literal */

import { createPublicClient, http, defineChain } from 'viem'
import { NETWORK_CONFIGS } from './networks.js'

const arcMainnet = defineChain({
  id:   5042,
  name: 'Arc',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } }, // arc-studio-allow-onchain-literal
})

const arcTestnet = defineChain({
  id:   5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } }, // arc-studio-allow-onchain-literal
})

export function getClient(networkKey: 'mainnet' | 'testnet') {
  const cfg = NETWORK_CONFIGS[networkKey]
  const chain = networkKey === 'mainnet' ? arcMainnet : arcTestnet
  return createPublicClient({
    chain,
    transport: http(cfg.rpcUrl, { timeout: 10_000 }),
  })
}
