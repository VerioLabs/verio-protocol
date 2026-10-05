# Verio protocol contracts

Solidity contracts behind [Verio](https://www.verio.network) on Base. Both are immutable: no owner,
no admin role, no proxy, no upgrade path, and neither holds funds.

| Contract | What it records | Base (8453) | Base Sepolia (84532) |
|---|---|---|---|
| [`ProofOfContribution`](src/ProofOfContribution.sol) | Contributors, content hashes they anchor, daily check-ins | [`0xC398F2Fa964245d765C445b87B427e52467225e2`](https://basescan.org/address/0xC398F2Fa964245d765C445b87B427e52467225e2#code) | — |
| [`ResourceRegistry`](src/ResourceRegistry.sol) | Paid resources for AI agents (models, tools, APIs, datasets, compute), their payees and prices; agent wallets | — | [`0xBfAB007FfDd73be58a7fAD66d6ac1766A7E45402`](https://sepolia.basescan.org/address/0xBfAB007FfDd73be58a7fAD66d6ac1766A7E45402#code) |

Each is deployed through the canonical CREATE2 factory with a fixed salt, so it has the same address
on every chain it is deployed to. Deployment blocks are in [`deployments/`](deployments), and the
deployment transactions are in [`broadcast/`](broadcast).

## ProofOfContribution

- `register(referrer)` registers the caller once, optionally crediting a referrer.
- `prove(contentHash)` anchors a content hash (sha256 of the bytes by convention) and registers the
  caller on first use.
- `checkIn()` records one check-in per UTC day.
- Events: `Registered`, `Proved`, `CheckedIn`.

## ResourceRegistry

A resource is identified on chain by four things: who owns it, which address gets paid, what one call
costs, and where its metadata lives. Payments do not pass through the contract. Agents pay the payee
directly, for example with an [x402](https://github.com/coinbase/x402) USDC authorization.

- `registerResource(payee, token, price, uri, metadataHash)` returns a sequential id starting at 1.
  `price` is per call, in the token's smallest unit. `metadataHash` is the sha256 of the document at
  `uri`, or zero.
- The owner can `updateResource` (payee, price, uri, hash), `deactivateResource` (final) and
  `transferResource`. The token is fixed at registration.
- **One payee, one resource, for good.** An address is bound to the first resource that uses it as a
  payee. The binding stays after a payee change or a deactivation, so every token transfer to a
  registered payee belongs to exactly one resource, from logs alone.
- `registerAgent(uri)` / `updateAgent(uri)` let a wallet declare itself an AI agent.
- Events: `ResourceRegistered`, `ResourceUpdated`, `ResourceDeactivated`, `ResourceTransferred`,
  `AgentRegistered`, `AgentUpdated`. They carry every field, so indexers need no storage reads.

## Why immutable

- **Nobody can redirect payments.** Agents check a resource's payee and price against the registry
  before paying. With no admin key, only a resource's owner can change them; an upgradeable registry
  would let whoever holds the upgrade key change where every agent's payment goes.
- **Nothing to pause.** Neither contract holds funds, so there is no balance an emergency switch would
  protect.
- **Stable history.** Indexers attribute payments by payee binding and decode the events by layout.
  Rules that cannot change keep years of logs readable the same way.
- **Smaller attack surface.** No proxy storage layout, no initializer, no privileged key to manage or
  lose.

A change means a new deployment with a new salt, at a new address.

## Build and test

```sh
git clone --recurse-submodules https://github.com/VerioLabs/verio-protocol
cd verio-protocol
forge test
```

Requires [Foundry](https://book.getfoundry.sh). Solidity 0.8.24, optimizer 1,000 runs, EVM `cancun`.

## Deploy

```sh
cp .env.example .env   # PRIVATE_KEY, RPC URLs, BASESCAN_API_KEY
source .env
forge script script/DeployResourceRegistry.s.sol --sig 'predict()'   # the address, before spending anything
forge script script/DeployResourceRegistry.s.sol --rpc-url base_sepolia --broadcast --verify --private-key $PRIVATE_KEY
```

`script/Deploy.s.sol` does the same for ProofOfContribution. Both scripts add their contract to
`deployments/<chainId>.json` and keep the other contracts already listed there.

## Attribution

Verio's transactions carry its Base Builder Code as an ERC-8021
suffix in the calldata. Both contracts accept any such trailing bytes, since the ABI decoder ignores
them.

## License

[MIT](LICENSE)
