#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import {
  createPublicClient,
  http,
  parseEventLogs,
  type Address,
  type Chain,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil, base, baseSepolia } from 'viem/chains'

import { resourceRegistryAbi } from './abi.js'
import { builderCodeSuffix } from './attribution.js'
import { createProofClient, resolveAddress } from './client.js'
import { contentHash } from './hash.js'
import { createRegistryClient, type PayeeAuth } from './registry.js'

const CHAINS: Record<number, Chain> = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [anvil.id]: anvil,
}

const USAGE = `verio — Verio CLI for ProofOfContribution and ResourceRegistry
(env: RPC_URL, PRIVATE_KEY, BUILDER_CODE, POC_ADDRESS? for ProofOfContribution, REGISTRY_ADDRESS? for ResourceRegistry)

  status [--address 0x..]                              totals, and one contributor's state
  resource register --payee 0x.. --price N --uri URI --metadata file [--token 0x..] [auth flags]
                                                       register a ResourceRegistry entry (REGISTRY_ADDRESS?)
  resource show <id>                                   one resource, as the registry stores it
  resource consent --payee 0x.. --owner 0x.. [--deadline N]
                                                       sign, as the payee's controller, that owner may bind it
  resource transfer <id> <newOwner>                    offer a resource (the zero address withdraws the offer)
  resource accept <id> --payee 0x.. [auth flags]       take an offered resource and set its payee
    auth flags: --beneficiary 0x.. --key 0x.. (a PayeeVault payee); --consent 0x.. --deadline N
                (a controller other than PRIVATE_KEY's address, from resource consent)
  suffix                                               print the ERC-8021 suffix for BUILDER_CODE
`

const env = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`missing env ${name}`)
  return v
}

async function chainFromRpc(rpcUrl: string): Promise<Chain> {
  const id = await createPublicClient({ transport: http(rpcUrl) }).getChainId()
  return CHAINS[id] ?? { ...anvil, id, name: `chain-${id}` }
}

async function status(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { address: { type: 'string' } },
  })
  const rpcUrl = env('RPC_URL')
  const chain = await chainFromRpc(rpcUrl)
  const address = resolveAddress(
    chain.id,
    process.env['POC_ADDRESS'] as Address | undefined,
  )
  const client = createProofClient({
    chain,
    transport: http(rpcUrl),
    account: privateKeyToAccount(generatePrivateKey()),
    builderCode: process.env['BUILDER_CODE'] ?? 'status',
    address,
  })
  const totals = await client.totals()
  console.log(`ProofOfContribution ${address} on ${chain.name} (${chain.id})`)
  console.log(`contributors: ${totals.contributors}`)
  console.log(`proofs: ${totals.proofs}`)
  if (values.address) {
    const c = await client.contributor(values.address as Address)
    console.log(
      `${values.address}: registeredAt=${c.registeredAt} proofs=${c.proofs} checkIns=${c.checkIns} lastCheckInDay=${c.lastCheckInDay}`,
    )
  }
}

/** USDC, the token resources are priced in by default. */
const USDC: Record<number, Address> = {
  [base.id]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  [baseSepolia.id]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
}

/**
 * How the payee's controller agrees (ResourceRegistry v2): `--beneficiary` and `--key` when the
 * payee is a PayeeVault; `--consent` and `--deadline` (from `resource consent`, signed by the
 * controller) when the controller is not PRIVATE_KEY's address.
 */
const AUTH_OPTIONS = {
  payee: { type: 'string' },
  beneficiary: { type: 'string' },
  key: { type: 'string' },
  consent: { type: 'string' },
  deadline: { type: 'string' },
} as const

function authFrom(v: {
  beneficiary?: string
  key?: string
  consent?: string
  deadline?: string
}): Partial<PayeeAuth> {
  if (Boolean(v.beneficiary) !== Boolean(v.key))
    throw new Error('--beneficiary and --key go together')
  if (Boolean(v.consent) !== Boolean(v.deadline))
    throw new Error('--consent and --deadline go together')
  if (v.deadline && !/^\d+$/.test(v.deadline))
    throw new Error('--deadline is a unix time in seconds')
  return {
    ...(v.beneficiary && {
      beneficiary: v.beneficiary as Address,
      key: v.key as Hex,
    }),
    ...(v.consent && {
      signature: v.consent as Hex,
      deadline: BigInt(v.deadline!),
    }),
  }
}

async function resource(args: string[]) {
  const [action, ...rest] = args
  const rpcUrl = env('RPC_URL')
  const chain = await chainFromRpc(rpcUrl)
  const address = process.env['REGISTRY_ADDRESS'] as Address | undefined
  const writer = () =>
    createRegistryClient({
      chain,
      transport: http(rpcUrl),
      account: privateKeyToAccount(env('PRIVATE_KEY') as Hex),
      builderCode: env('BUILDER_CODE'),
      ...(address && { address }),
    })
  const waitFor = async (hash: Hex, what: string) => {
    const receipt = await createPublicClient({
      chain,
      transport: http(rpcUrl),
    }).waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${what} failed: ${hash}`)
    return receipt
  }
  if (action === 'consent') {
    const { values } = parseArgs({
      args: rest,
      options: {
        payee: { type: 'string' },
        owner: { type: 'string' },
        deadline: { type: 'string' },
      },
    })
    if (!values.payee || !values.owner)
      throw new Error(
        'usage: resource consent --payee 0x.. --owner 0x.. [--deadline unixSeconds]',
      )
    if (values.deadline && !/^\d+$/.test(values.deadline))
      throw new Error('--deadline is a unix time in seconds')
    // Signed by PRIVATE_KEY as the payee's controller; needs no BUILDER_CODE, sends nothing.
    const consent = await createRegistryClient({
      chain,
      transport: http(rpcUrl),
      account: privateKeyToAccount(env('PRIVATE_KEY') as Hex),
      builderCode: '',
      ...(address && { address }),
    }).signPayeeConsent({
      payee: values.payee as Address,
      owner: values.owner as Address,
      ...(values.deadline && { deadline: BigInt(values.deadline) }),
    })
    console.log(
      JSON.stringify({
        deadline: consent.deadline.toString(),
        signature: consent.signature,
      }),
    )
    return
  }
  if (action === 'transfer') {
    const [id, to] = rest
    if (!id || !/^\d+$/.test(id) || !to)
      throw new Error(
        'usage: resource transfer <id> <newOwner> (0x0000000000000000000000000000000000000000 withdraws the offer)',
      )
    const hash = await writer().transferResource(BigInt(id), to as Address)
    await waitFor(hash, 'transfer')
    console.log(`offered resource ${id} to ${to} in ${hash}`)
    return
  }
  if (action === 'accept') {
    const [id, ...flags] = rest
    const { values } = parseArgs({ args: flags, options: AUTH_OPTIONS })
    if (!id || !/^\d+$/.test(id) || !values.payee)
      throw new Error(
        'usage: resource accept <id> --payee 0x.. [--beneficiary 0x.. --key 0x..] [--consent 0x.. --deadline N]',
      )
    const hash = await writer().acceptResource(
      BigInt(id),
      values.payee as Address,
      authFrom(values),
    )
    await waitFor(hash, 'accept')
    console.log(`took resource ${id}, payee ${values.payee}, in ${hash}`)
    return
  }
  if (action === 'show') {
    const id = rest[0]
    if (!id || !/^\d+$/.test(id)) throw new Error('usage: resource show <id>')
    const client = createRegistryClient({
      chain,
      transport: http(rpcUrl),
      account: privateKeyToAccount(generatePrivateKey()),
      builderCode: '',
      ...(address && { address }),
    })
    const [r, pendingOwner] = await Promise.all([
      client.resource(BigInt(id)),
      client.pendingOwner(BigInt(id)),
    ])
    console.log(
      JSON.stringify(
        { resourceId: id, ...r, price: r.price.toString(), pendingOwner },
        null,
        2,
      ),
    )
    return
  }
  if (action !== 'register')
    throw new Error(
      'usage: resource <register|show|consent|transfer|accept> ...',
    )
  const { values } = parseArgs({
    args: rest,
    options: {
      ...AUTH_OPTIONS,
      price: { type: 'string' },
      uri: { type: 'string' },
      metadata: { type: 'string' },
      token: { type: 'string' },
    },
  })
  if (!values.payee || !values.price || !values.uri || !values.metadata)
    throw new Error(
      'usage: resource register --payee 0x.. --price N --uri URI --metadata file [--token 0x..] [--beneficiary 0x.. --key 0x..] [--consent 0x.. --deadline N]',
    )
  if (!/^\d+$/.test(values.price))
    throw new Error(
      "--price is an integer in the token's smallest unit (USDC: 20000 = 0.02)",
    )
  const token = (values.token as Address | undefined) ?? USDC[chain.id]
  if (!token)
    throw new Error(`no default token on chain ${chain.id}; pass --token`)

  // The hash covers the exact bytes; refuse when what the URI serves differs from the file.
  const bytes = readFileSync(values.metadata)
  const metadataHash = await contentHash(bytes)
  if (values.uri.startsWith('https://')) {
    const served = new Uint8Array(await (await fetch(values.uri)).arrayBuffer())
    if ((await contentHash(served)) !== metadataHash)
      throw new Error(
        `${values.uri} does not serve the bytes of ${values.metadata}; deploy it first`,
      )
  }

  const hash = await writer().registerResource({
    payee: values.payee as Address,
    auth: authFrom(values),
    token,
    price: BigInt(values.price),
    uri: values.uri,
    metadataHash,
  })
  const receipt = await waitFor(hash, 'registration')
  const [log] = parseEventLogs({
    abi: resourceRegistryAbi,
    eventName: 'ResourceRegistered',
    logs: receipt.logs,
  })
  if (receipt.status !== 'success' || !log)
    throw new Error(`registration failed: ${hash}`)
  console.log(
    `registered resource ${log.args.resourceId} on ${chain.name} (${chain.id}) in ${hash}`,
  )
  console.log(`metadataHash ${metadataHash}`)
}

async function main() {
  const [cmd, sub, ...rest] = process.argv.slice(2)
  if (cmd === 'status')
    return status([sub, ...rest].filter((x): x is string => x !== undefined))
  if (cmd === 'resource')
    return resource([sub, ...rest].filter((x): x is string => x !== undefined))
  if (cmd === 'suffix')
    return console.log(builderCodeSuffix(env('BUILDER_CODE')))
  console.log(USAGE)
  process.exitCode = cmd ? 1 : 0
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
