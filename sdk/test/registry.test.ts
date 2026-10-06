import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  createPublicClient,
  http,
  parseAbi,
  parseEventLogs,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

import { contentHash } from '../src/hash.js'
import { createRegistryClient } from '../src/registry.js'
import { parseBuilderCodes } from '../src/attribution.js'
import { resourceRegistryAbi } from '../src/abi.js'

import {
  ANVIL_KEYS,
  deployRegistry,
  startAnvil,
  toolsAvailable,
} from './anvil.js'

const enabled = toolsAvailable()
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
/** EOA payees with keys of their own, so they can consent. */
const PAYEE_A_KEY = generatePrivateKey()
const PAYEE_A = privateKeyToAccount(PAYEE_A_KEY).address
const PAYEE_C_KEY = generatePrivateKey()
const PAYEE_C = privateKeyToAccount(PAYEE_C_KEY).address
const factoryAbi = parseAbi([
  'function vaultOf(address beneficiary, bytes32 key) view returns (address)',
])

describe.skipIf(!enabled)('createRegistryClient against anvil', () => {
  let proc: { kill(): void }
  let rpcUrl: string
  let address: Address
  let factory: Address

  beforeAll(async () => {
    const a = await startAnvil(8548)
    proc = a.proc
    rpcUrl = a.rpcUrl
    ;({ registry: address, factory } = deployRegistry(rpcUrl))
  })
  afterAll(() => proc?.kill())

  const client = (key: `0x${string}`) =>
    createRegistryClient({
      chain: anvil,
      transport: http(rpcUrl),
      account: privateKeyToAccount(key),
      builderCode: 'demo',
      address,
    })
  const pub = () =>
    createPublicClient({ chain: anvil, transport: http(rpcUrl) })
  const mined = (hash: Hash) => pub().waitForTransactionReceipt({ hash })
  const vaultOf = (beneficiary: Address, key: `0x${string}`) =>
    pub().readContract({
      address: factory,
      abi: factoryAbi,
      functionName: 'vaultOf',
      args: [beneficiary, key],
    })

  test('registerResource with the payee’s signed consent carries the builder-code suffix and stores the resource', async () => {
    const owner = privateKeyToAccount(ANVIL_KEYS[0]).address
    const registry = client(ANVIL_KEYS[0])
    const consent = await client(PAYEE_A_KEY).signPayeeConsent({
      payee: PAYEE_A,
      owner,
    })
    const now = BigInt(Math.floor(Date.now() / 1000))
    expect(consent.deadline > now && consent.deadline <= now + 900n).toBe(true)

    const txHash = await registry.registerResource({
      payee: PAYEE_A,
      auth: consent,
      token: USDC,
      price: 10_000n,
      uri: 'ipfs://a',
    })
    const receipt = await mined(txHash)
    expect(receipt.status).toBe('success')
    expect(
      parseBuilderCodes((await pub().getTransaction({ hash: txHash })).input),
    ).toEqual(['demo'])

    const [log] = parseEventLogs({
      abi: resourceRegistryAbi,
      eventName: 'ResourceRegistered',
      logs: receipt.logs,
    })
    expect(log?.args).toEqual({
      resourceId: 1n,
      owner,
      payee: PAYEE_A,
      token: USDC,
      price: 10_000n,
      uri: 'ipfs://a',
      metadataHash: zeroHash,
    })
    expect(await registry.resource(1n)).toEqual({
      owner,
      active: true,
      payee: PAYEE_A,
      token: USDC,
      price: 10_000n,
      metadataHash: zeroHash,
      uri: 'ipfs://a',
    })
    expect(await registry.resourceOfPayee(PAYEE_A)).toBe(1n)
  })

  test('a payee the account does not control needs its consent', async () => {
    await expect(
      client(ANVIL_KEYS[1]).registerResource({
        payee: PAYEE_C,
        token: USDC,
        price: 1n,
        uri: '',
      }),
    ).rejects.toThrow(/PayeeConsentRequired/)
    // A consent for another owner does not do either.
    const forSomeoneElse = await client(PAYEE_C_KEY).signPayeeConsent({
      payee: PAYEE_C,
      owner: privateKeyToAccount(ANVIL_KEYS[2]).address,
    })
    await expect(
      client(ANVIL_KEYS[1]).registerResource({
        payee: PAYEE_C,
        auth: forSomeoneElse,
        token: USDC,
        price: 1n,
        uri: '',
      }),
    ).rejects.toThrow(/BadSignature/)
  })

  test('a payee bound to one resource is rejected for another', async () => {
    const consent = await client(PAYEE_A_KEY).signPayeeConsent({
      payee: PAYEE_A,
      owner: privateKeyToAccount(ANVIL_KEYS[1]).address,
    })
    await expect(
      client(ANVIL_KEYS[1]).registerResource({
        payee: PAYEE_A,
        auth: consent,
        token: USDC,
        price: 1n,
        uri: '',
      }),
    ).rejects.toThrow(/PayeeTaken/)
  })

  test('only the owner can update, to its own vault without a signature; deactivation is final', async () => {
    const owner = privateKeyToAccount(ANVIL_KEYS[0]).address
    const key = `0x${'ab'.repeat(32)}` as const
    const vault = await vaultOf(owner, key)
    await expect(
      client(ANVIL_KEYS[1]).updateResource(1n, {
        payee: vault,
        auth: { beneficiary: owner, key },
        price: 1n,
        uri: '',
      }),
    ).rejects.toThrow(/NotResourceOwner/)

    const registry = client(ANVIL_KEYS[0])
    await mined(
      await registry.updateResource(1n, {
        payee: vault,
        auth: { beneficiary: owner, key },
        price: 20_000n,
        uri: 'ipfs://b',
      }),
    )
    expect((await registry.resource(1n)).payee).toBe(vault)

    await mined(await registry.deactivateResource(1n))
    await expect(registry.deactivateResource(1n)).rejects.toThrow(
      /ResourceInactive/,
    )
    expect(await registry.totals()).toEqual({
      resources: 1n,
      active: 0n,
      agents: 0n,
    })
  })

  test('a transfer is an offer until accepted, and acceptance sets the new owner’s vault', async () => {
    const alice = client(ANVIL_KEYS[0])
    const bob = client(ANVIL_KEYS[1])
    const bobAddress = privateKeyToAccount(ANVIL_KEYS[1]).address
    await mined(
      await alice.registerResource({
        payee: privateKeyToAccount(ANVIL_KEYS[0]).address,
        token: USDC,
        price: 1n,
        uri: 'ipfs://t',
      }),
    )
    const id = (await alice.totals()).resources

    await mined(await alice.transferResource(id, bobAddress))
    expect(await alice.pendingOwner(id)).toBe(bobAddress)
    await mined(await alice.cancelTransfer(id))
    expect(await alice.pendingOwner(id)).toBe(zeroAddress)
    await expect(bob.acceptResource(id, bobAddress)).rejects.toThrow(
      /NotPendingOwner/,
    )

    await mined(await alice.transferResource(id, bobAddress))
    const key = `0x${'cd'.repeat(32)}` as const
    const vault = await vaultOf(bobAddress, key)
    const receipt = await mined(
      await bob.acceptResource(id, vault, { beneficiary: bobAddress, key }),
    )
    expect(
      parseEventLogs({ abi: resourceRegistryAbi, logs: receipt.logs }).map(
        (l) => l.eventName,
      ),
    ).toEqual(['ResourceTransferred', 'ResourceUpdated'])
    expect(await bob.resource(id)).toMatchObject({
      owner: bobAddress,
      payee: vault,
    })
  })

  test('registerAgent marks the account once', async () => {
    const agent = privateKeyToAccount(ANVIL_KEYS[2]).address
    const registry = client(ANVIL_KEYS[2])
    await mined(await registry.registerAgent('https://agent.example'))
    expect(await registry.isAgent(agent)).toBe(true)
    await expect(registry.registerAgent('again')).rejects.toThrow(
      /AgentAlreadyRegistered/,
    )
    expect((await registry.totals()).agents).toBe(1n)
  })

  test('the CLI signs a payee’s consent and registers with it and the hash of the metadata file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'poc-resource-'))
    const file = join(dir, 'meta.json')
    const bytes = new TextEncoder().encode('{"name":"Echo","kind":"tool"}')
    writeFileSync(file, bytes)
    const cli = (args: string[], key: string = ANVIL_KEYS[1]) =>
      execFileSync(
        'node',
        [resolve(import.meta.dirname, '../dist/cli.js'), ...args],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            RPC_URL: rpcUrl,
            PRIVATE_KEY: key,
            BUILDER_CODE: 'demo',
            REGISTRY_ADDRESS: address,
          },
        },
      )
    const owner = privateKeyToAccount(ANVIL_KEYS[1]).address
    const consent = JSON.parse(
      cli(
        ['resource', 'consent', '--payee', PAYEE_C, '--owner', owner],
        PAYEE_C_KEY,
      ),
    ) as { deadline: string; signature: string }
    const out = cli([
      'resource',
      'register',
      '--payee',
      PAYEE_C,
      '--consent',
      consent.signature,
      '--deadline',
      consent.deadline,
      '--price',
      '20000',
      '--uri',
      'ipfs://echo',
      '--metadata',
      file,
      '--token',
      USDC,
    ])
    const id = out.match(/registered resource (\d+)/)?.[1]
    expect(id).toBeDefined()
    const shown = JSON.parse(cli(['resource', 'show', id!]))
    expect(shown).toMatchObject({
      resourceId: id,
      owner,
      payee: PAYEE_C,
      price: '20000',
      uri: 'ipfs://echo',
      metadataHash: await contentHash(bytes),
      pendingOwner: zeroAddress,
    })
  })
})
