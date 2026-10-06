import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type Transport,
} from 'viem'

import { contentHash } from './hash.js'
import { createRegistryClient, type PayeeConsent } from './registry.js'

export type HubClientConfig = {
  /** The Verio deployment, e.g. `https://verio-pre.vercel.app`. */
  apiBase: string
  /** An API key (`vk_…`), made in the app under API keys; it acts for that account. */
  apiKey: string
  fetch?: typeof fetch
}

export type RepoKind = 'model' | 'dataset'

export type RepoFile = {
  path: string
  sha256: string
  size: number
  contentType: string
  uploadedAt: number
}

/** A paid repository's listing: agents pay `price` per file at `endpoint`. */
export type RepoListing = {
  chainId: number
  /** Absent until the registration is confirmed. */
  resourceId?: number
  price: string
  token: string
  vault: string
  beneficiary: string
  key: string
  factory: string
  owner?: string
  endpoint: string
}

/**
 * A vault one of the account's listings was paid into. The hub keeps it after the repository is
 * made free or deleted: `factory.sweep(beneficiary, key, token)` withdraws, deployed or not.
 */
export type PayeeVault = {
  chainId: number
  vault: string
  factory: string
  beneficiary: string
  key: string
  token: string
  repoId: string
  /** Absent for a listing that was prepared but never registered. */
  resourceId?: number
  createdAt: number
}

/** A repository as the hub returns it (the fields scripts use; the API sends a few more). */
export type HubRepo = {
  id: string
  kind: RepoKind
  owner: string
  name: string
  summary: string
  license: string
  tags: string[]
  visibility: 'public' | 'private'
  card: string
  files: RepoFile[]
  revisions?: { number: number; message: string; manifest?: string }[]
  downloads: number
  mine?: boolean
  listing?: RepoListing
}

export type RepoDraft = {
  kind: RepoKind
  /** Your namespace: the first account to use an owner name claims it. */
  owner: string
  name: string
  license: string
  visibility: 'public' | 'private'
  summary?: string
  /** The README shown on the repository page (Markdown). */
  card?: string
  tags?: string[]
  task?: string
  library?: string
  modality?: string
  format?: string
}

/** A file to upload: its path in the repository and its bytes. */
export type FileInput = {
  path: string
  bytes: Uint8Array | Blob
  /** Defaults to `application/octet-stream`. */
  contentType?: string
}

/** What making a repository paid needs on chain. */
export type ListOnChainOptions = {
  /** Base or Base Sepolia, matching the listing chain of the deployment (`prepared.chainId`). */
  chain: Chain
  transport: Transport
  /** Registers the resource and owns it; it alone can make the repository free again. */
  account: Account
  /** Base Builder Code appended to the registration (ERC-8021). */
  builderCode: string
  /** Override the registry address (chains without a recorded deployment). */
  registry?: Address
}

export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HubError'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Public RPCs are load-balanced, and a node a few blocks behind does not know a resource registered
 * a moment ago (`UnknownResource`). Wait for it to catch up rather than fail.
 */
async function whenSynced<T>(read: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await read()
    } catch (error) {
      const unknown =
        error instanceof BaseError &&
        error.walk(
          (e) =>
            e instanceof ContractFunctionRevertedError &&
            e.data?.errorName === 'UnknownResource',
        )
      if (!unknown || i >= tries) throw error
      await sleep(1500)
    }
  }
}

/**
 * The Verio Hub over its HTTP API, signed in with an API key: create repositories, upload files as
 * new revisions, and make a repository paid so agents buy its files over x402.
 */
export function createHubClient(cfg: HubClientConfig) {
  const base = cfg.apiBase.replace(/\/$/, '')
  const doFetch = cfg.fetch ?? fetch

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        ...(init.headers ?? {}),
      },
    })
    const body = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok)
      throw new HubError(
        res.status,
        body.error ?? `request failed (${res.status})`,
      )
    return body
  }

  const hub = async (op: string, args: Record<string, unknown>) =>
    (
      await call<{ repo: HubRepo }>('/api/hub', {
        method: 'POST',
        body: JSON.stringify({ op, ...args }),
      })
    ).repo

  /** The API checks the chain through its own RPC, which can trail the wallet's by a few blocks. */
  async function untilConfirmed<T>(confirm: () => Promise<T>, tries = 8) {
    for (let i = 1; ; i++) {
      try {
        return await confirm()
      } catch (error) {
        if (
          i >= tries ||
          !(error instanceof HubError) ||
          (error.status !== 422 && error.status !== 409)
        )
          throw error
        await sleep(2000)
      }
    }
  }

  const client = {
    async getRepo(id: string): Promise<HubRepo> {
      return (
        await call<{ repo: HubRepo }>(
          `/api/hub?op=get&id=${encodeURIComponent(id)}`,
        )
      ).repo
    },

    createRepo: (draft: RepoDraft) => hub('create', { draft }),

    /** Every vault the account's listings were paid into, newest first, whatever became of them. */
    async listVaults(): Promise<PayeeVault[]> {
      return (await call<{ vaults: PayeeVault[] }>('/api/hub?op=vaults')).vaults
    },

    /** Changes what describes the repository (summary, card, tags, visibility, …). */
    updateRepo: (
      id: string,
      patch: Partial<Omit<RepoDraft, 'kind' | 'owner' | 'name'>>,
    ) => hub('update', { id, patch }),

    /**
     * Stores each file's bytes (S3 checks them against their sha256), then adds them all to the
     * repository as one new revision; files with an existing path are replaced.
     */
    async uploadFiles(id: string, files: FileInput[], message?: string) {
      const repo = await client.getRepo(id)
      const added: RepoFile[] = []
      for (const file of files) {
        const blob =
          file.bytes instanceof Blob
            ? file.bytes
            : new Blob([file.bytes as BlobPart])
        const sha256 = (await contentHash(await blob.arrayBuffer())).slice(2)
        const contentType = file.contentType ?? 'application/octet-stream'
        const ticket = await call<{
          url: string
          fields: Record<string, string>
        }>('/api/content/upload', {
          method: 'POST',
          body: JSON.stringify({ sha256, size: blob.size, contentType }),
        })
        const form = new FormData()
        for (const [k, v] of Object.entries(ticket.fields)) form.append(k, v)
        form.append('file', blob, file.path.split('/').pop() || file.path)
        const stored = await doFetch(ticket.url, { method: 'POST', body: form })
        if (!stored.ok)
          throw new HubError(
            stored.status,
            `storage rejected ${file.path} (${stored.status})`,
          )
        await call('/api/content/complete', {
          method: 'POST',
          body: JSON.stringify({
            sha256,
            name: file.path,
            contentType,
            size: blob.size,
            kind: repo.kind,
            repo: id,
          }),
        })
        added.push({
          path: file.path,
          sha256,
          size: blob.size,
          contentType,
          uploadedAt: Date.now(),
        })
      }
      return hub('addFiles', {
        id,
        files: added,
        ...(message ? { message } : {}),
      })
    },

    /**
     * Deletes the repository and its history; the namespace stays yours. A paid repository is
     * refused (HubError 409): `makeFree` it first, so its resource does not stay active.
     */
    async deleteRepo(id: string): Promise<void> {
      await call('/api/hub', {
        method: 'POST',
        body: JSON.stringify({ op: 'remove', id }),
      })
    },

    /** Removes a file from the latest revision, as a new revision; earlier ones keep it. */
    removeFile: (id: string, path: string, message?: string) =>
      hub('removeFile', { id, path, ...(message ? { message } : {}) }),

    /**
     * Makes the repository paid: everyone but you pays `price` (USDC units, 6 decimals) per file,
     * agents over x402. The hub prepares a fresh vault paying out to `beneficiary` (default: the
     * account), `account` registers the resource on chain, and the hub confirms it from the chain.
     * The registry binds the vault only with its beneficiary's consent: given by the account itself
     * when it is the beneficiary, otherwise by `beneficiaryConsent`, which gets the vault, the owner
     * and the registry once the hub has picked them, and returns the beneficiary's signed consent
     * (for example the beneficiary's own `createRegistryClient(…).signPayeeConsent`).
     */
    async listForAgents(
      id: string,
      price: bigint,
      chainOpts: ListOnChainOptions & {
        beneficiary?: Address
        beneficiaryConsent?: (request: {
          payee: Address
          owner: Address
          chainId: number
          registry: Address
        }) => Promise<PayeeConsent>
      },
    ): Promise<{ repo: HubRepo; txHash: Hash; resourceId: number }> {
      const owner = chainOpts.account.address
      const beneficiary = chainOpts.beneficiary ?? owner
      const isOwner = beneficiary.toLowerCase() === owner.toLowerCase()
      if (!isOwner && !chainOpts.beneficiaryConsent)
        throw new Error(
          'the vault pays out to another wallet: pass `beneficiaryConsent` so that wallet can consent',
        )
      const prepared = await call<{
        chainId: number
        registry: Address
        token: Address
        payee: Address
        beneficiary: Address
        key: Hex
        price: string
        uri: string
        metadataHash: Hex
      }>('/api/hub', {
        method: 'POST',
        body: JSON.stringify({
          op: 'prepareListing',
          id,
          beneficiary,
          price: price.toString(),
        }),
      })
      if (prepared.chainId !== chainOpts.chain.id)
        throw new Error(
          `the hub lists on chain ${prepared.chainId}; pass that chain, not ${chainOpts.chain.id}`,
        )
      const registry = createRegistryClient({
        chain: chainOpts.chain,
        transport: chainOpts.transport,
        account: chainOpts.account,
        builderCode: chainOpts.builderCode,
        address: chainOpts.registry ?? prepared.registry,
      })
      const consent = isOwner
        ? undefined
        : await chainOpts.beneficiaryConsent!({
            payee: prepared.payee,
            owner,
            chainId: prepared.chainId,
            registry: registry.address,
          })
      const txHash = await registry.registerResource({
        payee: prepared.payee,
        auth: {
          beneficiary: prepared.beneficiary,
          key: prepared.key,
          ...consent,
        },
        token: prepared.token,
        price: BigInt(prepared.price),
        uri: prepared.uri,
        metadataHash: prepared.metadataHash,
      })
      const receipt = await createPublicClient({
        chain: chainOpts.chain,
        transport: chainOpts.transport,
      }).waitForTransactionReceipt({ hash: txHash })
      if (receipt.status !== 'success')
        throw new Error(`the registration reverted (${txHash})`)
      const repo = await untilConfirmed(() =>
        hub('confirmListing', { id, txHash }),
      )
      return { repo, txHash, resourceId: repo.listing!.resourceId! }
    },

    /**
     * Makes a paid repository free again: deactivates its resource on chain (for good; listing it
     * again registers a new one), then unlists it. `account` must be the wallet that listed it.
     * What its vault holds stays withdrawable: `listVaults` keeps its key.
     */
    async makeFree(
      id: string,
      chainOpts: ListOnChainOptions,
    ): Promise<HubRepo> {
      const repo = await client.getRepo(id)
      const listing = repo.listing
      if (!listing) return repo
      if (listing.resourceId !== undefined) {
        const registry = createRegistryClient({
          chain: chainOpts.chain,
          transport: chainOpts.transport,
          account: chainOpts.account,
          builderCode: chainOpts.builderCode,
          ...(chainOpts.registry ? { address: chainOpts.registry } : {}),
        })
        const onChain = await whenSynced(() =>
          registry.resource(BigInt(listing.resourceId!)),
        )
        if (onChain.active) {
          const hash = await registry.deactivateResource(
            BigInt(listing.resourceId),
          )
          await createPublicClient({
            chain: chainOpts.chain,
            transport: chainOpts.transport,
          }).waitForTransactionReceipt({ hash })
        }
      }
      return untilConfirmed(() => hub('unlist', { id }))
    },
  }
  return client
}

export type HubClient = ReturnType<typeof createHubClient>
