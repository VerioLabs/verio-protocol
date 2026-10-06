import { createHash } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  createPublicClient,
  http,
  parseEventLogs,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

import { resourceRegistryAbi } from '../src/abi.js'
import { createHubClient, HubError, type HubRepo } from '../src/hub.js'
import { createRegistryClient } from '../src/registry.js'

import {
  ANVIL_KEYS,
  deployRegistry,
  startAnvil,
  toolsAvailable,
} from './anvil.js'

const API = 'https://verio.test'
const KEY = 'vk_0123456789ab_' + 'k'.repeat(43)
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const VAULT = '0x00000000000000000000000000000000000000c1' as Address
const KEY_HEX = `0x${'11'.repeat(32)}` as Hex

type Call = { url: string; method: string; auth?: string; body?: unknown }

/** The hub API in memory: records every request and answers like the real one. */
function fakeHub(
  opts: {
    confirm?: (txHash: Hash) => Promise<number | null>
    /** The vault `prepareListing` picks: a real `vaultOf(beneficiary, key)` against anvil. */
    vault?: (beneficiary: Address) => Promise<{ payee: Address; key: Hex }>
  } = {},
) {
  const calls: Call[] = []
  const repo: HubRepo = {
    id: 'acme/faces',
    kind: 'dataset',
    owner: 'acme',
    name: 'faces',
    summary: '',
    license: 'mit',
    tags: [],
    visibility: 'public',
    card: '',
    files: [],
    downloads: 0,
    mine: true,
  }
  let confirms = 0
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status })
  const fetchImpl = (async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const url = String(input)
    const headers = (init.headers ?? {}) as Record<string, string>
    const body =
      typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    calls.push({
      url,
      method: init.method ?? 'GET',
      auth: headers.authorization,
      body,
    })

    if (url === 'https://s3.test/bucket')
      return new Response(null, { status: 204 })
    if (headers.authorization !== `Bearer ${KEY}`)
      return json({ error: 'invalid token' }, 401)
    if (url.startsWith(`${API}/api/hub?op=get`)) return json({ repo })
    if (url === `${API}/api/hub?op=vaults`)
      return json({
        vaults: [
          {
            chainId: anvil.id,
            vault: VAULT,
            factory: '0x00000000000000000000000000000000000000fa',
            beneficiary: '0x00000000000000000000000000000000000a11ce',
            key: '0x' + '11'.repeat(32),
            token: USDC,
            repoId: 'acme/gone',
            createdAt: 1,
          },
        ],
      })
    if (url === `${API}/api/content/upload`)
      return json({
        url: 'https://s3.test/bucket',
        fields: { key: `content/u/${body.sha256}` },
      })
    if (url === `${API}/api/content/complete`) return json({ record: {} })
    if (url === `${API}/api/hub`) {
      switch (body.op) {
        case 'create':
          return json({
            repo: {
              ...repo,
              ...body.draft,
              id: `${body.draft.owner}/${body.draft.name}`,
            },
          })
        case 'addFiles':
          repo.files = body.files
          return json({ repo })
        case 'prepareListing': {
          const picked = (await opts.vault?.(body.beneficiary)) ?? {
            payee: VAULT,
            key: KEY_HEX,
          }
          return json({
            chainId: anvil.id,
            registry: '0x0000000000000000000000000000000000000000',
            token: USDC,
            payee: picked.payee,
            beneficiary: body.beneficiary,
            key: picked.key,
            price: body.price,
            uri: `${API}/api/hub?op=metadata&id=${body.id}`,
            metadataHash: '0x' + 'cd'.repeat(32),
          })
        }
        case 'confirmListing': {
          // The first try answers as if the API's RPC had not seen the block yet.
          if (confirms++ === 0)
            return json(
              {
                error:
                  'listing not confirmed: transaction not found on chain yet',
              },
              422,
            )
          const resourceId = await opts.confirm!(body.txHash)
          if (resourceId === null)
            return json({ error: 'not a registration' }, 422)
          repo.listing = {
            chainId: anvil.id,
            resourceId,
            price: '20000',
            token: USDC,
            vault: VAULT,
            beneficiary: '',
            key: '',
            factory: '',
            endpoint: '',
          }
          return json({ repo })
        }
        case 'remove':
          return json({})
        case 'unlist':
          delete repo.listing
          return json({ repo })
      }
    }
    return json({ error: 'unknown' }, 404)
  }) as typeof fetch
  return { calls, repo, fetch: fetchImpl }
}

describe('createHubClient', () => {
  test('creates a repository with the API key', async () => {
    const h = fakeHub()
    const hub = createHubClient({
      apiBase: `${API}/`,
      apiKey: KEY,
      fetch: h.fetch,
    })
    const repo = await hub.createRepo({
      kind: 'dataset',
      owner: 'acme',
      name: 'faces',
      license: 'mit',
      visibility: 'public',
    })
    expect(repo.id).toBe('acme/faces')
    expect(h.calls[0]).toMatchObject({
      url: `${API}/api/hub`,
      method: 'POST',
      auth: `Bearer ${KEY}`,
      body: { op: 'create', draft: { owner: 'acme', name: 'faces' } },
    })
  })

  test('uploads each file to storage under its sha256, records it, then adds them as one revision', async () => {
    const h = fakeHub()
    const hub = createHubClient({ apiBase: API, apiKey: KEY, fetch: h.fetch })
    const bytes = new TextEncoder().encode('a,b\n1,2\n')
    const sha = createHash('sha256').update(bytes).digest('hex')
    const repo = await hub.uploadFiles(
      'acme/faces',
      [{ path: 'data/train.csv', bytes, contentType: 'text/csv' }],
      'Add the training split',
    )

    expect(h.calls.map((c) => `${c.method} ${c.url.replace(API, '')}`)).toEqual(
      [
        'GET /api/hub?op=get&id=acme%2Ffaces',
        'POST /api/content/upload',
        'POST https://s3.test/bucket',
        'POST /api/content/complete',
        'POST /api/hub',
      ],
    )
    expect(h.calls[1]!.body).toEqual({
      sha256: sha,
      size: bytes.length,
      contentType: 'text/csv',
    })
    const form = h.calls[2]!.body as FormData
    expect(form.get('key')).toBe(`content/u/${sha}`)
    expect((form.get('file') as File).name).toBe('train.csv')
    expect(h.calls[2]!.auth).toBeUndefined()
    expect(h.calls[3]!.body).toMatchObject({
      sha256: sha,
      name: 'data/train.csv',
      kind: 'dataset',
      repo: 'acme/faces',
    })
    expect(h.calls[4]!.body).toMatchObject({
      op: 'addFiles',
      id: 'acme/faces',
      message: 'Add the training split',
      files: [
        {
          path: 'data/train.csv',
          sha256: sha,
          size: bytes.length,
          contentType: 'text/csv',
        },
      ],
    })
    expect(repo.files).toHaveLength(1)
  })

  test('deletes a repository', async () => {
    const h = fakeHub()
    const hub = createHubClient({ apiBase: API, apiKey: KEY, fetch: h.fetch })
    await hub.deleteRepo('acme/faces')
    expect(h.calls[0]).toMatchObject({
      url: `${API}/api/hub`,
      body: { op: 'remove', id: 'acme/faces' },
    })
  })

  test('lists the account’s vaults with what withdrawing needs', async () => {
    const h = fakeHub()
    const hub = createHubClient({ apiBase: API, apiKey: KEY, fetch: h.fetch })
    expect(await hub.listVaults()).toEqual([
      expect.objectContaining({
        vault: VAULT,
        key: '0x' + '11'.repeat(32),
        repoId: 'acme/gone',
      }),
    ])
    expect(h.calls[0]).toMatchObject({ method: 'GET', auth: `Bearer ${KEY}` })
  })

  test('a refused request is a HubError with its status and message', async () => {
    const h = fakeHub()
    const hub = createHubClient({
      apiBase: API,
      apiKey: 'vk_wrong',
      fetch: h.fetch,
    })
    const error = await hub.getRepo('acme/faces').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HubError)
    expect(error).toMatchObject({ status: 401, message: 'invalid token' })
  })
})

describe.skipIf(!toolsAvailable())(
  'listForAgents and makeFree against anvil',
  () => {
    let proc: { kill(): void }
    let rpcUrl: string
    let registry: Address
    let factory: Address

    beforeAll(async () => {
      const a = await startAnvil(8550)
      proc = a.proc
      rpcUrl = a.rpcUrl
      ;({ registry, factory } = deployRegistry(rpcUrl))
    })
    afterAll(() => proc?.kill())

    /** A fake hub that picks real vaults, and confirms from the registration log the way the API does. */
    const chainHub = (key: Hex) => {
      const chain = createPublicClient({
        chain: anvil,
        transport: http(rpcUrl),
      })
      const picked: Address[] = []
      const h = fakeHub({
        vault: async (beneficiary) => {
          const payee = await chain.readContract({
            address: factory,
            abi: parseAbi([
              'function vaultOf(address beneficiary, bytes32 key) view returns (address)',
            ]),
            functionName: 'vaultOf',
            args: [beneficiary, key],
          })
          picked.push(payee)
          return { payee, key }
        },
        confirm: async (txHash) => {
          const receipt = await chain.getTransactionReceipt({ hash: txHash })
          const [log] = parseEventLogs({
            abi: resourceRegistryAbi,
            eventName: 'ResourceRegistered',
            logs: receipt.logs,
          })
          return log && log.args.payee === picked.at(-1)
            ? Number(log.args.resourceId)
            : null
        },
      })
      return { h, chain, picked }
    }

    test('registers the prepared listing on chain and confirms it; makeFree deactivates and unlists', async () => {
      const transport = http(rpcUrl)
      const account = privateKeyToAccount(ANVIL_KEYS[0])
      const { h, chain, picked } = chainHub(KEY_HEX)
      const hub = createHubClient({ apiBase: API, apiKey: KEY, fetch: h.fetch })
      const opts = {
        chain: anvil,
        transport,
        account,
        builderCode: 'demo',
        registry,
      }

      const listed = await hub.listForAgents('acme/faces', 20_000n, opts)
      expect(listed.resourceId).toBe(1)
      expect(
        h.calls.find(
          (c) => (c.body as { op?: string })?.op === 'prepareListing',
        )!.body,
      ).toMatchObject({
        beneficiary: account.address,
        price: '20000',
      })
      const onChain = await chain.readContract({
        address: registry,
        abi: resourceRegistryAbi,
        functionName: 'getResource',
        args: [1n],
      })
      expect(onChain).toMatchObject({
        owner: account.address,
        price: 20_000n,
        active: true,
      })
      // The vault of the account's own, bound with no signature: the account is its beneficiary.
      expect(onChain.payee).toBe(picked[0])

      const free = await hub.makeFree('acme/faces', opts)
      expect(free.listing).toBeUndefined()
      const after = await chain.readContract({
        address: registry,
        abi: resourceRegistryAbi,
        functionName: 'getResource',
        args: [1n],
      })
      expect(after.active).toBe(false)
    })

    test('a vault for another wallet is bound with that wallet’s consent, asked once the vault is known', async () => {
      const owner = privateKeyToAccount(ANVIL_KEYS[1])
      const beneficiary = privateKeyToAccount(ANVIL_KEYS[2])
      const { h, chain, picked } = chainHub(`0x${'22'.repeat(32)}`)
      const hub = createHubClient({ apiBase: API, apiKey: KEY, fetch: h.fetch })
      const opts = {
        chain: anvil,
        transport: http(rpcUrl),
        account: owner,
        builderCode: 'demo',
        registry,
        beneficiary: beneficiary.address,
      }
      await expect(
        hub.listForAgents('acme/faces', 20_000n, opts),
      ).rejects.toThrow(/beneficiaryConsent/)
      expect(h.calls).toHaveLength(0)

      const asked: unknown[] = []
      const listed = await hub.listForAgents('acme/faces', 20_000n, {
        ...opts,
        beneficiaryConsent: (request) => {
          asked.push(request)
          return createRegistryClient({
            chain: anvil,
            transport: http(rpcUrl),
            account: beneficiary,
            builderCode: '',
            address: request.registry,
          }).signPayeeConsent(request)
        },
      })
      expect(asked).toEqual([
        { payee: picked[0], owner: owner.address, chainId: anvil.id, registry },
      ])
      const onChain = await chain.readContract({
        address: registry,
        abi: resourceRegistryAbi,
        functionName: 'getResource',
        args: [BigInt(listed.resourceId)],
      })
      expect(onChain).toMatchObject({ owner: owner.address, payee: picked[0] })
    })

    test('refuses a chain other than the one the hub lists on', async () => {
      const h = fakeHub()
      const hub = createHubClient({ apiBase: API, apiKey: KEY, fetch: h.fetch })
      await expect(
        hub.listForAgents('acme/faces', 20_000n, {
          chain: { ...anvil, id: 8453 },
          transport: http(rpcUrl),
          account: privateKeyToAccount(ANVIL_KEYS[0]),
          builderCode: 'demo',
        }),
      ).rejects.toThrow(/lists on chain 31337/)
    })
  },
)
