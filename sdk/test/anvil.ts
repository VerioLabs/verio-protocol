import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPublicClient, http, type Address } from 'viem'

// contracts/ next to packages/ in the monorepo; the repository root in verio-protocol, where this
// package is mirrored to sdk/.
const MONOREPO_CONTRACTS = resolve(import.meta.dirname, '../../../contracts')

export const CONTRACTS_DIR = existsSync(MONOREPO_CONTRACTS)
  ? MONOREPO_CONTRACTS
  : resolve(import.meta.dirname, '../..')

export const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
] as const

export function toolsAvailable(): boolean {
  try {
    execFileSync('anvil', ['--version'], { stdio: 'ignore' })
    execFileSync('forge', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export async function startAnvil(
  port: number,
): Promise<{ proc: ChildProcess; rpcUrl: string }> {
  const proc = spawn('anvil', ['--port', String(port), '--silent'], {
    stdio: 'ignore',
  })
  const rpcUrl = `http://127.0.0.1:${port}`
  const client = createPublicClient({ transport: http(rpcUrl) })
  for (let i = 0; i < 100; i++) {
    try {
      await client.getChainId()
      return { proc, rpcUrl }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  proc.kill()
  throw new Error('anvil did not start')
}

export function deployWithForge(
  rpcUrl: string,
  script = 'Deploy',
  contract = 'ProofOfContribution',
  env: Record<string, string> = {},
): Address {
  const out = execFileSync(
    'forge',
    [
      'script',
      `script/${script}.s.sol`,
      '--rpc-url',
      rpcUrl,
      '--broadcast',
      '--private-key',
      ANVIL_KEYS[0],
      '--non-interactive',
    ],
    {
      cwd: CONTRACTS_DIR,
      encoding: 'utf8',
      env: {
        ...process.env,
        FOUNDRY_DISABLE_NIGHTLY_WARNING: '1',
        // Several test files deploy at once, all on chain 31337: none writes deployments/31337.json.
        SKIP_DEPLOYMENTS_FILE: 'true',
        ...env,
      },
    },
  )
  const m = out.match(
    new RegExp(
      `${contract} (?:deployed at|already deployed at) (0x[0-9a-fA-F]{40})`,
    ),
  )
  if (!m?.[1]) throw new Error(`could not parse deploy output:\n${out}`)
  return m[1] as Address
}

/**
 * Deploys PayeeVaultFactory, then ResourceRegistry v2 on top of it. The factory is passed by env:
 * test deploys do not write `deployments/31337.json`.
 */
export function deployRegistry(rpcUrl: string) {
  const factory = deployWithForge(
    rpcUrl,
    'DeployPayeeVaultFactory',
    'PayeeVaultFactory',
  )
  const registry = deployWithForge(
    rpcUrl,
    'DeployResourceRegistry',
    'ResourceRegistry',
    { PAYEE_VAULT_FACTORY: factory },
  )
  return { factory, registry }
}

export const forgeArtifactExists = (contract = 'ProofOfContribution') =>
  existsSync(resolve(CONTRACTS_DIR, `out/${contract}.sol/${contract}.json`))
