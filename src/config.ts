/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arc.id, 'https://rpc.mainnet.arc.io')

export const config = createConfig({
  chains: [arcTestnet, arc, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    // viem's arc definition has no default RPC URL — supply it explicitly
    [arc.id]: http('https://rpc.mainnet.arc.io'),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
