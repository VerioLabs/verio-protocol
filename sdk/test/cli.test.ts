import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPublicClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

import { createProofClient } from '../src/client.js'

import {
  ANVIL_KEYS,
  deployWithForge,
  startAnvil,
  toolsAvailable,
} from './anvil.js'

const enabled = toolsAvailable()
const CLI = resolve(import.meta.dirname, '../dist/cli.js')

describe.skipIf(!enabled)('verio CLI against anvil', () => {
  let proc: { kill(): void }
  let rpcUrl: string
  let address: Address
  const run = (args: string[]) =>
    execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      cwd: resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        RPC_URL: rpcUrl,
        PRIVATE_KEY: ANVIL_KEYS[0],
        BUILDER_CODE: 'demo',
        POC_ADDRESS: address,
      },
    })

  beforeAll(async () => {
    const a = await startAnvil(8547)
    proc = a.proc
    rpcUrl = a.rpcUrl
    address = deployWithForge(rpcUrl)
  })
  afterAll(() => proc?.kill())

  test('status reports totals and one contributor', async () => {
    const account = privateKeyToAccount(ANVIL_KEYS[1])
    const proof = createProofClient({
      chain: anvil,
      transport: http(rpcUrl),
      account,
      builderCode: 'demo',
      address,
    })
    const pub = createPublicClient({ transport: http(rpcUrl) })
    await pub.waitForTransactionReceipt({
      hash: await proof.prove(`0x${'11'.repeat(32)}`),
    })

    const status = run(['status', '--address', account.address])
    expect(status).toMatch(/contributors: 1/)
    expect(status).toMatch(/proofs: 1/)
    expect(status).toMatch(/registeredAt/)
  })

  test('the batch commands are not part of the public CLI', () => {
    expect(() =>
      run(['wallets', 'gen', '--count', '1', '--out', 'x.json']),
    ).toThrow()
  })
})
