# @veriolabs/sdk

TypeScript clients for Verio on Base:

- **ProofOfContribution**: register, prove, check in.
- **ResourceRegistry**: register and manage paid resources for AI agents (models, tools, APIs,
  datasets, compute).
- **`@veriolabs/sdk/agent`**: discover resources, then pay for and call them over
  [x402](https://github.com/coinbase/x402).
- **`@veriolabs/sdk/hub`**: publish datasets and models to the Verio Hub with an API key, and
  make them paid so agents buy their files.

Every write carries the app's Base Builder Code as an ERC-8021 suffix in the calldata.

```sh
npm install @veriolabs/sdk viem
```

`viem` ^2.23 is a peer dependency. The package is ESM only and needs Node 20.19 or later, where
`require()` loads it too.

## Deployments

| Contract            | Chain                | Address                                      |
| ------------------- | -------------------- | -------------------------------------------- |
| ProofOfContribution | Base (8453)          | `0xC398F2Fa964245d765C445b87B427e52467225e2` |
| ResourceRegistry    | Base (8453)          | `0xb80B0b88c55Af8f7Be65c407ae05B15466218d30` |
| PayeeVaultFactory   | Base (8453)          | `0xE01E989dc82547144aE92918104a90336220d0df` |
| ResourceRegistry    | Base Sepolia (84532) | `0xb80B0b88c55Af8f7Be65c407ae05B15466218d30` |
| PayeeVaultFactory   | Base Sepolia (84532) | `0xE01E989dc82547144aE92918104a90336220d0df` |

ResourceRegistry is v2 (since SDK 0.2.0): writes that bind a payee take its consent (`auth`). The
contracts are deployed with CREATE2, so each has the same address on every chain where it is
deployed (the registry wherever the factory is). `deployments` exports these addresses with their start blocks. On a chain without a
recorded deployment, pass `address`.

## ResourceRegistry

```ts
import { createRegistryClient, contentHash } from '@veriolabs/sdk'
import { http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const registry = createRegistryClient({
  chain: baseSepolia,
  transport: http(),
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
  builderCode: 'your_builder_code',
})

await registry.registerResource({
  payee: '0x…', // receives payments; bound to this resource for good
  // The payee's consent: none when the account is the payee; `{ beneficiary, key }` for a
  // PayeeVault of the account's; otherwise the payee controller's `signPayeeConsent` result.
  auth: consent,
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC on Base Sepolia
  price: 20_000n, // per call, in the token's smallest unit (0.02 USDC)
  uri: 'https://example.com/resource.json',
  metadataHash: await contentHash(metadataBytes), // sha256 of the document at `uri`
})
```

The other methods are `updateResource`, `deactivateResource`, `transferResource` (an offer),
`cancelTransfer`, `acceptResource(id, payee, auth?)`, `pendingOwner(id)`, `registerAgent`,
`updateAgent`, `resource(id)`, `resourceOfPayee(address)`, `isAgent(address)` and `totals()`.

A payee address can back only one resource, ever. Every token transfer to a registered payee
therefore belongs to exactly one resource, which is why the registry binds a payee only with the
consent of whoever controls it (the payee, or its PayeeVault's beneficiary). When that is not the
sending account, the controller signs for the owner, valid for 15 minutes by default (a day at
most), and the owner passes the result as `auth`:

```ts
const consent = await payeeRegistryClient.signPayeeConsent({ payee, owner })
```

`payeeConsentTypedData` gives the same EIP-712 message for any other signer (a browser wallet, say).
Transfers are two-step: the new owner's `acceptResource` sets the payee in the same transaction,
since a vault's beneficiary never changes.

## Agents: discover and pay over x402

```ts
import { discover, invoke } from '@veriolabs/sdk/agent'

const [resource] = await discover('https://www.verio.network', {
  capabilities: ['image-generation'],
  maxPrice: 20_000n,
  sort: 'price',
})

const { result, payment } = await invoke({
  endpoint: resource.endpoint!,
  chainId: resource.chainId,
  resourceId: resource.resourceId,
  body: { prompt: 'a cat astronaut, watercolor', assetId: '0x…' },
  account, // a viem LocalAccount holding USDC; it needs no ETH
  maxAmount: 20_000n,
})
```

Before signing, `invoke` reads the resource from the registry. It pays only an offer whose payee,
token, network and amount match what the registry says, and never more than `maxAmount`. A call
that fails is not charged.

Search results also carry each resource's 30-day stats, its gateway performance (success rate and
latency) and a reputation score with its inputs.

The agent client is a separate entry point. Code that imports only `@veriolabs/sdk` does not load
the x402 client.

## Hub: publish and sell datasets and models

Make an API key in the app (your account menu, **API keys**). It acts for your account, so keep it
secret; revoke it there when it leaks. Keys are made and revoked only from the app.

```ts
import { createHubClient } from '@veriolabs/sdk/hub'
import { readFile } from 'node:fs/promises'
import { http } from 'viem'
import { baseSepolia } from 'viem/chains'

const hub = createHubClient({
  apiBase: 'https://www.verio.network',
  apiKey: process.env.VERIO_API_KEY!,
})

await hub.createRepo({
  kind: 'dataset',
  owner: 'acme', // your namespace; the first account to use a name claims it
  name: 'faces',
  license: 'mit',
  visibility: 'public',
  summary: 'Labelled faces',
})
await hub.uploadFiles(
  'acme/faces',
  [
    {
      path: 'data/train.csv',
      bytes: await readFile('train.csv'),
      contentType: 'text/csv',
    },
  ],
  'Add the training split',
)

// Optional: everyone but you pays 0.02 USDC per file; agents pay over x402.
const { resourceId } = await hub.listForAgents('acme/faces', 20_000n, {
  chain: baseSepolia, // the chain the deployment lists on
  transport: http(),
  account, // registers the resource (needs a little ETH for gas); payouts go to it by default
  builderCode: 'bc_…',
  // To pay out to another wallet: `beneficiary`, plus `beneficiaryConsent`, which that wallet
  // answers once the hub has picked the vault, e.g. with its own client's `signPayeeConsent`.
})
```

`uploadFiles` stores each file (storage checks the bytes against their sha256), then adds them all
as one new revision. `listForAgents` gives the repository its own payee vault: the hub prepares the
listing, `account` registers it in the ResourceRegistry, and the hub confirms it from the chain.
`makeFree(id, sameOptions)` deactivates the resource (for good) and makes the files free again; the
vault keeps what it holds until someone sweeps it to its beneficiary.

## ProofOfContribution

```ts
import { createProofClient, contentHash } from '@veriolabs/sdk'

const proof = createProofClient({
  chain: base,
  transport: http(),
  account,
  builderCode: 'your_builder_code',
})
await proof.prove(await contentHash(fileBytes))
```

## CLI

The package installs a `verio` command. It reads `RPC_URL`, `PRIVATE_KEY` and `BUILDER_CODE` from the
environment.

```sh
verio resource register --payee 0x… --price 20000 --uri https://… --metadata ./resource.json
verio resource show 1
verio status
verio suffix          # print the ERC-8021 suffix for BUILDER_CODE
```

`resource register` hashes the local metadata file. It refuses to register when the bytes served at
`--uri` differ from that file.
