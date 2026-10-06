import {
  createWalletClient,
  encodeFunctionData,
  publicActions,
  zeroAddress,
  zeroHash,
  type Account,
  type Address,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hash,
  type Hex,
  type Transport,
} from 'viem'

import { resourceRegistryAbi } from './abi.js'
import { withBuilderCode } from './attribution.js'
import { deployments } from './deployments.js'

export type RegistryClientConfig = {
  chain: Chain
  transport: Transport
  /** A local account, or the address of a JSON-RPC account served by the transport (injected wallets). */
  account: Account | Address
  /** Base Builder Code from dashboard.base.org; appended to every write as an ERC-8021 suffix. Empty = no attribution. */
  builderCode: string
  /** Override the deployed address (required on chains without a recorded deployment). */
  address?: Address
}

export type Resource = {
  owner: Address
  active: boolean
  payee: Address
  token: Address
  /** Per call, in the token's smallest unit (USDC: 6 decimals). */
  price: bigint
  metadataHash: Hex
  uri: string
}

/**
 * How a payee's controller agrees to the payee being bound (ResourceRegistry v2). The controller is
 * the payee itself, or, when `beneficiary` and `key` are set, the beneficiary of the PayeeVault
 * `vaultOf(beneficiary, key)` the payee is. When the controller is the sending account nothing else
 * is needed; otherwise pass its consent from `signPayeeConsent` (`deadline` and `signature`).
 */
export type PayeeAuth = {
  beneficiary: Address
  key: Hex
  deadline: bigint
  signature: Hex
}

/** A signed `PayeeConsent`: what a payee's controller hands the owner who will bind it. */
export type PayeeConsent = Pick<PayeeAuth, 'deadline' | 'signature'>

export type ResourceInput = {
  /** Receives payments; one payee per resource, for good. */
  payee: Address
  price: bigint
  uri: string
  /** Hash of the metadata document at `uri` (see `contentHash`); zero when omitted. */
  metadataHash?: Hex
  /** The payee controller's consent; omit when the account is the payee. */
  auth?: Partial<PayeeAuth>
}

/** How long a consent from `signPayeeConsent` stays valid by default; the contract allows a day at most. */
export const DEFAULT_CONSENT_SECONDS = 15 * 60

const fullAuth = (auth: Partial<PayeeAuth> = {}): PayeeAuth => ({
  beneficiary: auth.beneficiary ?? zeroAddress,
  key: auth.key ?? zeroHash,
  deadline: auth.deadline ?? 0n,
  signature: auth.signature ?? '0x',
})

/**
 * The EIP-712 message a payee's controller signs to let `owner` bind `payee` until `deadline` (unix
 * seconds), for any signer: `signTypedData(payeeConsentTypedData(…))`. Bound to one chain and registry.
 */
export function payeeConsentTypedData(p: {
  chainId: number
  registry: Address
  payee: Address
  owner: Address
  deadline: bigint
}) {
  return {
    domain: {
      name: 'ResourceRegistry',
      version: '2',
      chainId: p.chainId,
      verifyingContract: p.registry,
    },
    types: {
      PayeeConsent: [
        { name: 'payee', type: 'address' },
        { name: 'owner', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'PayeeConsent',
    message: { payee: p.payee, owner: p.owner, deadline: p.deadline },
  } as const
}

export type RegistryClient = {
  address: Address
  /** Register a resource owned by the account. The new id is in the `ResourceRegistered` log. */
  registerResource(input: ResourceInput & { token: Address }): Promise<Hash>
  /** Change payee, price and metadata; the token never changes. Owner only. */
  updateResource(resourceId: bigint, input: ResourceInput): Promise<Hash>
  /** Deactivate for good. Owner only. */
  deactivateResource(resourceId: bigint): Promise<Hash>
  /** Offer the resource to `newOwner`, who takes it with `acceptResource`. Owner only. */
  transferResource(resourceId: bigint, newOwner: Address): Promise<Hash>
  /** Withdraw a pending offer. Owner only. */
  cancelTransfer(resourceId: bigint): Promise<Hash>
  /**
   * Take a resource offered to the account and set its payee in the same step; passing the current
   * payee keeps it (and the revenue with whoever controls it).
   */
  acceptResource(
    resourceId: bigint,
    payee: Address,
    auth?: Partial<PayeeAuth>,
  ): Promise<Hash>
  /** Who the resource is offered to, or the zero address. */
  pendingOwner(resourceId: bigint): Promise<Address>
  /**
   * The account consents, as `payee`'s controller (the payee, or its vault's beneficiary), to
   * `owner` binding `payee`; valid for `DEFAULT_CONSENT_SECONDS` unless `deadline` is given.
   */
  signPayeeConsent(p: {
    payee: Address
    owner: Address
    deadline?: bigint
  }): Promise<PayeeConsent>
  /** Declare the account an agent wallet, once. */
  registerAgent(uri: string): Promise<Hash>
  updateAgent(uri: string): Promise<Hash>
  resource(resourceId: bigint): Promise<Resource>
  /** The resource a payee is bound to, or 0n. */
  resourceOfPayee(payee: Address): Promise<bigint>
  isAgent(who: Address): Promise<boolean>
  totals(): Promise<{ resources: bigint; active: bigint; agents: bigint }>
}

export function resolveRegistryAddress(
  chainId: number,
  override?: Address,
): Address {
  const address = override ?? deployments[chainId]?.resourceRegistry
  if (!address)
    throw new Error(
      `ResourceRegistry has no recorded deployment on chain ${chainId}; pass \`address\``,
    )
  return address
}

type WriteName = ContractFunctionName<typeof resourceRegistryAbi, 'nonpayable'>

export function createRegistryClient(
  cfg: RegistryClientConfig,
): RegistryClient {
  const address = resolveRegistryAddress(cfg.chain.id, cfg.address)
  const wallet = createWalletClient({
    chain: cfg.chain,
    transport: cfg.transport,
    account: cfg.account,
  }).extend(publicActions)
  const base = { address, abi: resourceRegistryAbi } as const

  // Simulate first so reverts surface as decoded custom errors, then send the raw calldata with the suffix.
  const write = async <N extends WriteName>(
    functionName: N,
    args: ContractFunctionArgs<typeof resourceRegistryAbi, 'nonpayable', N>,
  ): Promise<Hash> => {
    const call = { abi: resourceRegistryAbi, functionName, args } as never
    await wallet.simulateContract({ ...base, ...(call as object) } as never)
    return wallet.sendTransaction({
      to: address,
      data: withBuilderCode(encodeFunctionData(call), cfg.builderCode),
    })
  }

  return {
    address,
    registerResource: ({
      payee,
      auth,
      token,
      price,
      uri,
      metadataHash = zeroHash,
    }) =>
      write('registerResource', [
        payee,
        fullAuth(auth),
        token,
        price,
        uri,
        metadataHash,
      ]),
    updateResource: (
      id,
      { payee, auth, price, uri, metadataHash = zeroHash },
    ) =>
      write('updateResource', [
        id,
        payee,
        fullAuth(auth),
        price,
        uri,
        metadataHash,
      ]),
    deactivateResource: (id) => write('deactivateResource', [id]),
    transferResource: (id, newOwner) =>
      write('transferResource', [id, newOwner]),
    cancelTransfer: (id) => write('transferResource', [id, zeroAddress]),
    acceptResource: (id, payee, auth) =>
      write('acceptResource', [id, payee, fullAuth(auth)]),
    pendingOwner: (id) =>
      wallet.readContract({
        ...base,
        functionName: 'pendingOwnerOf',
        args: [id],
      }),
    async signPayeeConsent({ payee, owner, deadline }) {
      const until =
        deadline ??
        BigInt(Math.floor(Date.now() / 1000) + DEFAULT_CONSENT_SECONDS)
      const signature = await wallet.signTypedData({
        account: cfg.account,
        ...payeeConsentTypedData({
          chainId: cfg.chain.id,
          registry: address,
          payee,
          owner,
          deadline: until,
        }),
      })
      return { deadline: until, signature }
    },
    registerAgent: (uri) => write('registerAgent', [uri]),
    updateAgent: (uri) => write('updateAgent', [uri]),
    resource: (id) =>
      wallet.readContract({ ...base, functionName: 'getResource', args: [id] }),
    resourceOfPayee: (payee) =>
      wallet.readContract({
        ...base,
        functionName: 'resourceOfPayee',
        args: [payee],
      }),
    isAgent: (who) =>
      wallet.readContract({ ...base, functionName: 'isAgent', args: [who] }),
    totals: async () => {
      const [resources, active, agents] = await Promise.all([
        wallet.readContract({ ...base, functionName: 'totalResources' }),
        wallet.readContract({ ...base, functionName: 'activeResources' }),
        wallet.readContract({ ...base, functionName: 'totalAgents' }),
      ])
      return { resources, active, agents }
    },
  }
}
