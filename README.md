# Verio protocol contracts

Solidity contracts behind [Verio](https://www.verio.network) on Base. All are immutable: no owner,
no admin role, no proxy, no upgrade path. Only a PayeeVault holds funds, and only on its way to its
fixed beneficiary.

| Contract | What it records | Base (8453) | Base Sepolia (84532) |
|---|---|---|---|
| [`ProofOfContribution`](src/ProofOfContribution.sol) | Contributors, content hashes they anchor, daily check-ins | [`0xC398F2Fa964245d765C445b87B427e52467225e2`](https://basescan.org/address/0xC398F2Fa964245d765C445b87B427e52467225e2#code) | — |
| [`ResourceRegistry`](src/ResourceRegistry.sol) (v2) | Paid resources for AI agents (models, tools, APIs, datasets, compute), their payees and prices; agent wallets | [`0xb80B0b88c55Af8f7Be65c407ae05B15466218d30`](https://basescan.org/address/0xb80B0b88c55Af8f7Be65c407ae05B15466218d30#code) | [`0xb80B0b88c55Af8f7Be65c407ae05B15466218d30`](https://sepolia.basescan.org/address/0xb80B0b88c55Af8f7Be65c407ae05B15466218d30#code) |
| [`PayeeVaultFactory`](src/PayeeVaultFactory.sol) | One CREATE2 payee address per resource, each paying out only to its beneficiary | [`0xE01E989dc82547144aE92918104a90336220d0df`](https://basescan.org/address/0xE01E989dc82547144aE92918104a90336220d0df#code) | [`0xE01E989dc82547144aE92918104a90336220d0df`](https://sepolia.basescan.org/address/0xE01E989dc82547144aE92918104a90336220d0df#code) |

Each is deployed through the canonical CREATE2 factory with a fixed salt, so it has the same address
on every chain it is deployed to. Deployment blocks are in [`deployments/`](deployments), and the
deployment transactions are in [`broadcast/`](broadcast). ResourceRegistry takes the chain's
PayeeVaultFactory as its constructor argument, so it shares an address across chains whose factory
does. ResourceRegistry v1 (`0xBfAB007FfDd73be58a7fAD66d6ac1766A7E45402`, Base Sepolia only) is
retired: it let anyone bind any address as a payee.

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

- `registerResource(payee, auth, token, price, uri, metadataHash)` returns a sequential id starting
  at 1. `price` is per call, in the token's smallest unit. `metadataHash` is the sha256 of the
  document at `uri`, or zero.
- The owner can `updateResource` (payee, price, uri, hash), `deactivateResource` (final) and
  `transferResource`. The token is fixed at registration.
- **One payee, one resource, for good.** An address is bound to the first resource that uses it as a
  payee. The binding stays after a payee change or a deactivation, so every token transfer to a
  registered payee belongs to exactly one resource, from logs alone.
- **A payee is bound only with its controller's consent**, since binding attributes the address's
  income to the resource. The controller is the payee itself, or the beneficiary of the PayeeVault it
  is (`auth.beneficiary`, `auth.key`). It consents by being the caller, or by an EIP-712 signature of
  `PayeeConsent(payee, owner, deadline)` (domain `ResourceRegistry`, version `2`; ECDSA or ERC-1271),
  valid for at most a day (`MAX_CONSENT_TTL`). The consent names the owner, so a copied one only ever
  registers a resource owned by the seller.
- **Transfers are two-step.** `transferResource(id, to)` offers the resource (`address(0)` withdraws
  the offer); `acceptResource(id, payee, auth)` makes the caller owner and sets the payee in the same
  step, since a vault's beneficiary never changes.
- `registerAgent(uri)` / `updateAgent(uri)` let a wallet declare itself an AI agent.
- Events: `ResourceRegistered`, `ResourceUpdated`, `ResourceDeactivated`, `ResourceTransferStarted`,
  `ResourceTransferred`, `AgentRegistered`, `AgentUpdated`. They carry every field, so indexers need
  no storage reads.

## PayeeVault and PayeeVaultFactory

A seller with several resources needs several payees. `vaultOf(beneficiary, key)` is a CREATE2
address that can receive tokens before any code is there; `sweep(beneficiary, key, token)` deploys
the vault if needed and sends its whole balance to the beneficiary. Anyone may call it, and the funds
can only go to the beneficiary, which is part of the init code. `sweepMany` does several at once. The
vault's own `sweepTo(token, to)` is the beneficiary's way out if it cannot receive a token itself.
Events: `VaultDeployed`, `Swept`.

## Why immutable

- **Nobody can redirect payments.** Agents check a resource's payee and price against the registry
  before paying. With no admin key, only a resource's owner can change them; an upgradeable registry
  would let whoever holds the upgrade key change where every agent's payment goes.
- **Nothing to pause.** The registry holds no funds, and a vault's balance can only go to its fixed
  beneficiary, so there is no balance an emergency switch would protect.
- **Stable history.** Indexers attribute payments by payee binding and decode the events by layout.
  Rules that cannot change keep years of logs readable the same way.
- **Smaller attack surface.** No proxy storage layout, no initializer, no privileged key to manage or
  lose.

A change means a new deployment with a new salt, at a new address.

## SDK

[`sdk/`](sdk) is [`@veriolabs/sdk`](https://www.npmjs.com/package/@veriolabs/sdk): viem clients for
these contracts that add the ERC-8021 Builder Code to every write, an x402 client for agents that
pay for registered resources, and the `verio` CLI. See its [README](sdk/README.md).

## Build and test

```sh
git clone --recurse-submodules https://github.com/VerioLabs/verio-protocol
cd verio-protocol
forge test
```

Requires [Foundry](https://book.getfoundry.sh). Solidity 0.8.24, optimizer 1,000 runs, EVM `cancun`.

The SDK's tests deploy the contracts to anvil, so they need Foundry too and a `forge build` first:

```sh
forge build && cd sdk && npm ci && npm test
```

## Deploy

```sh
cp .env.example .env   # PRIVATE_KEY, RPC URLs, BASESCAN_API_KEY
source .env
forge script script/DeployPayeeVaultFactory.s.sol --rpc-url base_sepolia --broadcast --verify --private-key $PRIVATE_KEY
forge script script/DeployResourceRegistry.s.sol --rpc-url base_sepolia --sig 'predict()'   # the address, before spending anything
forge script script/DeployResourceRegistry.s.sol --rpc-url base_sepolia --broadcast --verify --private-key $PRIVATE_KEY
```

The registry script reads the factory from `deployments/<chainId>.json`, so deploy the factory
first. `script/Deploy.s.sol` does the same for ProofOfContribution. Every script adds its contract to
`deployments/<chainId>.json` and keeps the others already listed there; a dry run (no `--broadcast`)
writes nothing.

## Attribution

Verio's transactions carry its Base Builder Code as an ERC-8021
suffix in the calldata. Every contract accepts any such trailing bytes, since the ABI decoder ignores
them.

## License

[MIT](LICENSE)
