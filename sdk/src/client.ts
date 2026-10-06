import {
  createWalletClient,
  encodeFunctionData,
  publicActions,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type Transport,
} from 'viem'

import { proofOfContributionAbi } from './abi.js'
import { withBuilderCode } from './attribution.js'
import { deployments } from './deployments.js'

export type ProofClientConfig = {
  chain: Chain
  transport: Transport
  /** A local account, or the address of a JSON-RPC account served by the transport (injected wallets). */
  account: Account | Address
  /** Base Builder Code from dashboard.base.org; appended to every write as an ERC-8021 suffix. Empty = no attribution. */
  builderCode: string
  /** Override the deployed address (required on chains without a recorded deployment). */
  address?: Address
}

export type Contributor = {
  registeredAt: number
  proofs: number
  checkIns: number
  lastCheckInDay: number
}

export type ProofClient = {
  address: Address
  /** Register once; `referrer` defaults to the zero address. */
  register(referrer?: Address): Promise<Hash>
  /** Anchor a content hash (see `contentHash`); registers the account on first use. */
  prove(contentHash: Hex): Promise<Hash>
  /** One check-in per UTC day; registers the account on first use. */
  checkIn(): Promise<Hash>
  contributor(who: Address): Promise<Contributor>
  totals(): Promise<{ contributors: bigint; proofs: bigint }>
}

export function resolveAddress(chainId: number, override?: Address): Address {
  const address = override ?? deployments[chainId]?.proofOfContribution
  if (!address)
    throw new Error(
      `ProofOfContribution has no recorded deployment on chain ${chainId}; pass \`address\``,
    )
  return address
}

export function createProofClient(cfg: ProofClientConfig): ProofClient {
  const address = resolveAddress(cfg.chain.id, cfg.address)
  const wallet = createWalletClient({
    chain: cfg.chain,
    transport: cfg.transport,
    account: cfg.account,
  }).extend(publicActions)
  const base = { address, abi: proofOfContributionAbi } as const
  const code = cfg.builderCode

  // Simulate first so reverts surface as decoded custom errors, then send the raw calldata with the suffix.
  const send = async (data: Hex) =>
    wallet.sendTransaction({ to: address, data: withBuilderCode(data, code) })

  return {
    address,
    register: async (referrer: Address = zeroAddress) => {
      await wallet.simulateContract({
        ...base,
        functionName: 'register',
        args: [referrer],
      })
      return send(
        encodeFunctionData({
          abi: proofOfContributionAbi,
          functionName: 'register',
          args: [referrer],
        }),
      )
    },
    prove: async (contentHash: Hex) => {
      await wallet.simulateContract({
        ...base,
        functionName: 'prove',
        args: [contentHash],
      })
      return send(
        encodeFunctionData({
          abi: proofOfContributionAbi,
          functionName: 'prove',
          args: [contentHash],
        }),
      )
    },
    checkIn: async () => {
      await wallet.simulateContract({ ...base, functionName: 'checkIn' })
      return send(
        encodeFunctionData({
          abi: proofOfContributionAbi,
          functionName: 'checkIn',
        }),
      )
    },
    contributor: async (who: Address): Promise<Contributor> => {
      const [registeredAt, proofs, checkIns, lastCheckInDay] =
        await wallet.readContract({
          ...base,
          functionName: 'contributors',
          args: [who],
        })
      return { registeredAt, proofs, checkIns, lastCheckInDay }
    },
    totals: async () => {
      const [contributors, proofs] = await Promise.all([
        wallet.readContract({ ...base, functionName: 'totalContributors' }),
        wallet.readContract({ ...base, functionName: 'totalProofs' }),
      ])
      return { contributors, proofs }
    },
  }
}
