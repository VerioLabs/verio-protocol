import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import { proofOfContributionAbi, resourceRegistryAbi } from '../src/abi.js'

import { CONTRACTS_DIR, forgeArtifactExists } from './anvil.js'

describe('proofOfContributionAbi', () => {
  test.skipIf(!forgeArtifactExists())(
    'equals the compiled forge artifact',
    () => {
      const artifact = JSON.parse(
        readFileSync(
          resolve(
            CONTRACTS_DIR,
            'out/ProofOfContribution.sol/ProofOfContribution.json',
          ),
          'utf8',
        ),
      )
      const norm = (abi: unknown[]) =>
        JSON.stringify(
          [...abi].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          ),
        )
      expect(norm(proofOfContributionAbi as unknown as unknown[])).toBe(
        norm(artifact.abi),
      )
    },
  )
})

describe('resourceRegistryAbi', () => {
  test.skipIf(!forgeArtifactExists('ResourceRegistry'))(
    'equals the compiled forge artifact',
    () => {
      const artifact = JSON.parse(
        readFileSync(
          resolve(
            CONTRACTS_DIR,
            'out/ResourceRegistry.sol/ResourceRegistry.json',
          ),
          'utf8',
        ),
      )
      const norm = (abi: unknown[]) =>
        JSON.stringify(
          [...abi].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          ),
        )
      expect(norm(resourceRegistryAbi as unknown as unknown[])).toBe(
        norm(artifact.abi),
      )
    },
  )
})
