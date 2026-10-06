/**
 * Agent side of Verio resources: discover, then pay and call over x402. Imported as
 * `@veriolabs/sdk/agent`, apart from the main entry, so apps that only use the registry or
 * proofs do not bundle the x402 client.
 */
import type { PaymentRequirements } from '@x402/core/types'
import { ExactEvmScheme } from '@x402/evm'
import {
  decodePaymentResponseHeader,
  wrapFetchWithPaymentFromConfig,
} from '@x402/fetch'
import {
  createPublicClient,
  http,
  type Address,
  type Chain,
  type LocalAccount,
  type Transport,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'

import { resourceRegistryAbi } from './abi.js'
import { resolveRegistryAddress } from './registry.js'

/** A resource as the discovery API lists it. Amounts are decimal strings in the token's smallest unit. */
export type DiscoveredResource = {
  chainId: number
  resourceId: number
  name: string | null
  description: string | null
  kind: 'model' | 'tool' | 'api' | 'dataset' | 'compute' | null
  capabilities: string[]
  /** Where to call it (the metadata's `endpoint`), or null. */
  endpoint: string | null
  /** JSON with its live details (for a Hub repository, the current files), or null. */
  catalog: string | null
  owner: Address
  payee: Address
  token: Address
  price: string
  uri: string
  metadataHash: string
  metadataStatus:
    | 'pending'
    | 'verified'
    | 'unverified'
    | 'mismatch'
    | 'invalid'
    | 'unreachable'
  active: boolean
  registeredAt: number
  stats30d: { calls: number; payers: number; volume: string }
  /** Calls through the Verio invoke gateway in the last 30 days (resources Verio serves). */
  performance30d: {
    calls: number
    served: number
    /** Failures the resource caused (5xx). */
    resourceFailures: number
    /** Requests the resource refused (4xx); not held against it. */
    callerErrors: number
    settleFailures: number
    /** served ÷ (served + resourceFailures); null before any. */
    successRate: number | null
    latencyMs: { p50: number; p95: number } | null
  }
  /** Off-chain score, 0–100, with what it is made of. */
  reputation: {
    version: 'v1'
    score: number
    inputs: Record<string, number>
    components: {
      reliability: number
      volume: number
      diversity: number
      age: number
    }
    weights: {
      reliability: number
      volume: number
      diversity: number
      age: number
    }
  }
}

export type DiscoverQuery = {
  chainId?: number
  /** Text in the name or description. */
  q?: string
  kind?: DiscoveredResource['kind']
  /** Every listed capability must match. */
  capabilities?: string[]
  maxPrice?: bigint
  token?: Address
  sort?: 'usage' | 'price' | 'newest' | 'latency' | 'reliability'
  limit?: number
  offset?: number
}

/**
 * Search a Verio deployment's discovery API (`GET /api/resources`). Only active resources whose
 * metadata checked out are returned.
 */
export async function discover(
  apiBase: string,
  query: DiscoverQuery = {},
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredResource[]> {
  const params = new URLSearchParams()
  const set = (k: string, v: string | number | bigint | undefined) => {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  set('chainId', query.chainId)
  set('q', query.q)
  set('kind', query.kind ?? undefined)
  set('capability', query.capabilities?.join(','))
  set('maxPrice', query.maxPrice)
  set('token', query.token)
  set('sort', query.sort)
  set('limit', query.limit)
  set('offset', query.offset)
  const res = await fetchImpl(
    `${apiBase.replace(/\/$/, '')}/api/resources?${params}`,
  )
  const body = (await res.json()) as {
    resources?: DiscoveredResource[]
    error?: string
  }
  if (!res.ok || !body.resources)
    throw new Error(
      `discovery failed (${res.status}): ${body.error ?? 'no resources in response'}`,
    )
  return body.resources
}

const CHAINS: Record<number, Chain> = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
}

export type InvokeOptions = {
  /** The resource's invoke endpoint (its metadata `endpoint`). */
  endpoint: string
  chainId: number
  resourceId: bigint | number
  /** JSON request body. */
  body: unknown
  /** The agent wallet that signs the USDC authorization; it needs USDC, not ETH. */
  account: LocalAccount
  /** Most the agent will pay for this call, in the token's smallest unit. */
  maxAmount: bigint
  /** Reads the registry; defaults to the chain's public RPC. */
  transport?: Transport
  /** Override the registry address (required on chains without a recorded deployment). */
  registry?: Address
  fetch?: typeof fetch
}

export type InvokeResult<T> = {
  result: T
  payment: { transaction: string; network: string; payer: string }
}

/**
 * Pay for and call a resource over x402. Before signing anything, the price, payee and token are
 * read from the ResourceRegistry: the agent pays only an offer that matches them exactly, and never
 * more than `maxAmount`. Throws when the resource is inactive, the offer does not match, or the
 * call fails (a failed call is not charged).
 */
export async function invoke<T = unknown>(
  opts: InvokeOptions,
): Promise<InvokeResult<T>> {
  const chain = CHAINS[opts.chainId]
  if (!chain && !opts.transport)
    throw new Error(`unknown chain ${opts.chainId}; pass a transport`)
  const client = createPublicClient({
    ...(chain && { chain }),
    transport: opts.transport ?? http(),
  })
  const onChain = await client.readContract({
    address: resolveRegistryAddress(opts.chainId, opts.registry),
    abi: resourceRegistryAbi,
    functionName: 'getResource',
    args: [BigInt(opts.resourceId)],
  })
  if (!onChain.active)
    throw new Error(`resource ${opts.resourceId} is deactivated`)
  if (onChain.price > opts.maxAmount)
    throw new Error(
      `resource ${opts.resourceId} costs ${onChain.price}, more than maxAmount ${opts.maxAmount}`,
    )

  const network = `eip155:${opts.chainId}` as const
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const matchesRegistry = (r: PaymentRequirements) =>
    r.network === network &&
    same(r.payTo, onChain.payee) &&
    same(r.asset, onChain.token) &&
    BigInt(r.amount) === onChain.price &&
    BigInt(r.amount) <= opts.maxAmount

  let offered: PaymentRequirements[] = []
  const pay = wrapFetchWithPaymentFromConfig(opts.fetch ?? fetch, {
    schemes: [{ network, client: new ExactEvmScheme(opts.account) }],
    // Only the registry's token, capped at maxAmount in atomic units (not the client's $1 default).
    spendControls: {
      maxAmountPerPayment: false,
      allowedAssets: [
        {
          network,
          asset: onChain.token,
          maxAmountPerPayment: opts.maxAmount.toString(),
        },
      ],
    },
    policies: [
      (_, requirements) => {
        offered = requirements
        return requirements.filter(matchesRegistry)
      },
    ],
  })

  let res: Response
  try {
    res = await pay(opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts.body),
    })
  } catch (cause) {
    if (offered.length && !offered.some(matchesRegistry))
      throw new Error(
        `the endpoint asked for a payment that does not match resource ${opts.resourceId} in the registry ` +
          `(payTo ${onChain.payee}, ${onChain.price} of ${onChain.token}); nothing was signed`,
        { cause },
      )
    throw cause
  }
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok)
    throw new Error(
      `invoke failed (${res.status}): ${body.error ?? JSON.stringify(body)}`,
    )
  const header = res.headers.get('PAYMENT-RESPONSE')
  const settled = header ? decodePaymentResponseHeader(header) : undefined
  const { payment, ...result } = body as T & {
    payment?: InvokeResult<T>['payment']
  }
  return {
    result: result as T,
    payment: payment ?? {
      transaction: settled?.transaction ?? '',
      network: settled?.network ?? network,
      payer: settled?.payer ?? opts.account.address,
    },
  }
}
