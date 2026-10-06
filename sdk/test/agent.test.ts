import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http'
import type { PaymentRequired } from '@x402/core/types'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPublicClient, getAddress, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

import { discover, invoke } from '../src/agent.js'
import { createRegistryClient } from '../src/registry.js'

import {
  ANVIL_KEYS,
  deployRegistry,
  startAnvil,
  toolsAvailable,
} from './anvil.js'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
/** The owner is its own payee, so registering needs no consent. */
const PAYEE = privateKeyToAccount(ANVIL_KEYS[0]).address
const OTHER = getAddress('0x00000000000000000000000000000000000000e5')
const TX = '0x' + 'ee'.repeat(32)
const ENDPOINT = 'https://gateway.test/api/invoke/1'

/** A gateway in a function: 402 with the given terms, then 200 for any signed payment. */
function fakeGateway(terms: { payTo: string; amount: string }) {
  const signatures: string[] = []
  const required: PaymentRequired = {
    x402Version: 2,
    resource: {
      url: ENDPOINT,
      description: 'Echo',
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: `eip155:${anvil.id}`,
        asset: USDC,
        amount: terms.amount,
        payTo: terms.payTo,
        maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2' },
      },
    ],
  }
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // @x402/fetch retries with a Request object, the first call is (url, init).
    const req = new Request(input, init)
    const signature = req.headers.get('PAYMENT-SIGNATURE')
    if (!signature)
      return new Response(JSON.stringify(required), {
        status: 402,
        headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required) },
      })
    signatures.push(signature)
    const settled = {
      success: true,
      transaction: TX,
      network: `eip155:${anvil.id}` as const,
      payer: '0xagent',
    }
    return new Response(
      JSON.stringify({
        echo: JSON.parse(await req.text()).text,
        payment: settled,
      }),
      {
        status: 200,
        headers: { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(settled) },
      },
    )
  }) as typeof fetch
  return { fetchImpl, signatures }
}

describe.skipIf(!toolsAvailable())('invoke against a registry on anvil', () => {
  let proc: { kill(): void }
  let rpcUrl: string
  let registry: Address
  const agent = privateKeyToAccount(ANVIL_KEYS[2])

  beforeAll(async () => {
    const a = await startAnvil(8549)
    proc = a.proc
    rpcUrl = a.rpcUrl
    registry = deployRegistry(rpcUrl).registry
    const owner = createRegistryClient({
      chain: anvil,
      transport: http(rpcUrl),
      account: privateKeyToAccount(ANVIL_KEYS[0]),
      builderCode: 'demo',
      address: registry,
    })
    const pub = createPublicClient({ chain: anvil, transport: http(rpcUrl) })
    await pub.waitForTransactionReceipt({
      hash: await owner.registerResource({
        payee: PAYEE,
        token: USDC,
        price: 20_000n,
        uri: 'ipfs://echo',
      }),
    })
  })
  afterAll(() => proc?.kill())

  const call = (fetchImpl: typeof fetch, maxAmount = 50_000n) =>
    invoke<{ echo: string }>({
      endpoint: ENDPOINT,
      chainId: anvil.id,
      resourceId: 1,
      body: { text: 'hi' },
      account: agent,
      maxAmount,
      transport: http(rpcUrl),
      registry,
      fetch: fetchImpl,
    })

  test('pays an offer that matches the registry and returns the result', async () => {
    const gw = fakeGateway({ payTo: PAYEE, amount: '20000' })
    const res = await call(gw.fetchImpl)
    expect(res.result).toEqual({ echo: 'hi' })
    expect(res.payment.transaction).toBe(TX)
    expect(gw.signatures).toHaveLength(1)
    const signed = decodePaymentSignatureHeader(gw.signatures[0]!)
    expect(signed.accepted).toMatchObject({ payTo: PAYEE, amount: '20000' })
    expect(signed.payload).toMatchObject({
      authorization: { from: agent.address, to: PAYEE, value: '20000' },
    })
  })

  test('signs nothing when the endpoint asks to pay someone else or a different amount', async () => {
    for (const terms of [
      { payTo: OTHER, amount: '20000' },
      { payTo: PAYEE, amount: '20001' },
    ]) {
      const gw = fakeGateway(terms)
      await expect(call(gw.fetchImpl)).rejects.toThrow(
        /does not match resource 1 in the registry/,
      )
      expect(gw.signatures).toHaveLength(0)
    }
  })

  test('refuses before any request when the registry price is above maxAmount', async () => {
    let requests = 0
    const counting = (async () => {
      requests++
      return new Response('{}')
    }) as typeof fetch
    await expect(call(counting, 19_999n)).rejects.toThrow(/more than maxAmount/)
    expect(requests).toBe(0)
  })
})

describe('discover', () => {
  test('builds the query and returns the resources', async () => {
    let url = ''
    const fetchImpl = (async (u: string) => {
      url = u
      return new Response(JSON.stringify({ resources: [{ resourceId: 1 }] }))
    }) as unknown as typeof fetch
    const found = await discover(
      'https://verio.test/',
      {
        capabilities: ['image-generation', 'png'],
        maxPrice: 20_000n,
        sort: 'price',
      },
      fetchImpl,
    )
    expect(found).toEqual([{ resourceId: 1 }])
    expect(url).toBe(
      'https://verio.test/api/resources?capability=image-generation%2Cpng&maxPrice=20000&sort=price',
    )
  })

  test('throws with the API error', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'kind must be one of …' }), {
        status: 400,
      })) as unknown as typeof fetch
    await expect(discover('https://verio.test', {}, fetchImpl)).rejects.toThrow(
      /discovery failed \(400\): kind must be/,
    )
  })
})
