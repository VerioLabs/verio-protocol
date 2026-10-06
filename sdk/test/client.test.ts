import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPublicClient, http, parseEventLogs, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

import { createProofClient } from '../src/client.js'
import { parseBuilderCodes } from '../src/attribution.js'
import { proofOfContributionAbi } from '../src/abi.js'

import {
  ANVIL_KEYS,
  deployWithForge,
  startAnvil,
  toolsAvailable,
} from './anvil.js'

const enabled = toolsAvailable()

describe.skipIf(!enabled)('createProofClient against anvil', () => {
  let proc: { kill(): void }
  let rpcUrl: string
  let address: Address

  beforeAll(async () => {
    const a = await startAnvil(8546)
    proc = a.proc
    rpcUrl = a.rpcUrl
    address = deployWithForge(rpcUrl)
  })
  afterAll(() => proc?.kill())

  test('writes carry the builder-code suffix and update contributor state', async () => {
    const account = privateKeyToAccount(ANVIL_KEYS[1])
    const client = createProofClient({
      chain: anvil,
      transport: http(rpcUrl),
      account,
      builderCode: 'demo',
      address,
    })
    const pub = createPublicClient({ chain: anvil, transport: http(rpcUrl) })

    const hash = ('0x' + 'ab'.repeat(32)) as `0x${string}`
    const txHash = await client.prove(hash)
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    expect(receipt.status).toBe('success')

    const tx = await pub.getTransaction({ hash: txHash })
    expect(parseBuilderCodes(tx.input)).toEqual(['demo'])

    const logs = parseEventLogs({
      abi: proofOfContributionAbi,
      logs: receipt.logs,
    })
    expect(logs.map((l) => l.eventName)).toEqual(['Registered', 'Proved'])

    const c = await client.contributor(account.address)
    expect(c.proofs).toBe(1)
    expect(c.registeredAt).toBeGreaterThan(0)
    expect(await client.totals()).toEqual({ contributors: 1n, proofs: 1n })
  })

  test('checkIn twice in a day rejects the second call', async () => {
    const account = privateKeyToAccount(ANVIL_KEYS[2])
    const client = createProofClient({
      chain: anvil,
      transport: http(rpcUrl),
      account,
      builderCode: 'demo',
      address,
    })
    const pub = createPublicClient({ chain: anvil, transport: http(rpcUrl) })
    await pub.waitForTransactionReceipt({ hash: await client.checkIn() })
    await expect(client.checkIn()).rejects.toThrow(/AlreadyCheckedInToday/)
    expect((await client.contributor(account.address)).checkIns).toBe(1)
  })

  test('register with a referrer emits Registered(contributor, referrer)', async () => {
    const account = privateKeyToAccount(ANVIL_KEYS[0])
    const referrer = privateKeyToAccount(ANVIL_KEYS[1]).address
    const client = createProofClient({
      chain: anvil,
      transport: http(rpcUrl),
      account,
      builderCode: 'demo',
      address,
    })
    const pub = createPublicClient({ chain: anvil, transport: http(rpcUrl) })
    const receipt = await pub.waitForTransactionReceipt({
      hash: await client.register(referrer),
    })
    const [log] = parseEventLogs({
      abi: proofOfContributionAbi,
      eventName: 'Registered',
      logs: receipt.logs,
    })
    expect(log?.args).toEqual({ contributor: account.address, referrer })
  })
})
