import { describe, expect, test } from 'vitest'

import { contentHash } from '../src/hash.js'

describe('contentHash', () => {
  test('is sha256 of the bytes as a bytes32 hex', async () => {
    // sha256("abc")
    expect(await contentHash(new TextEncoder().encode('abc'))).toBe(
      '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
  test('accepts an ArrayBuffer', async () => {
    const buf = new TextEncoder().encode('abc').buffer
    expect(await contentHash(buf)).toBe(
      '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
