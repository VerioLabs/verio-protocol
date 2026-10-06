import { describe, expect, test } from 'vitest'

import {
  builderCodeSuffix,
  parseBuilderCodes,
  assertBuilderCode,
} from '../src/attribution.js'

describe('builderCodeSuffix (ERC-8021 schema 0)', () => {
  test('matches the ox reference vector for "baseapp"', () => {
    expect(builderCodeSuffix('baseapp')).toBe(
      '0x62617365617070070080218021802180218021802180218021',
    )
  })
  test('layout is codes ∥ len ∥ 0x00 ∥ marker', () => {
    const s = builderCodeSuffix('demo')
    expect(s).toBe(
      '0x' + '64656d6f' + '04' + '00' + '80218021802180218021802180218021',
    )
  })
  test('round-trips through parseBuilderCodes when appended to calldata', () => {
    const data = ('0xdeadbeef' +
      builderCodeSuffix('demo').slice(2)) as `0x${string}`
    expect(parseBuilderCodes(data)).toEqual(['demo'])
  })
  test('parseBuilderCodes returns undefined for unsuffixed calldata', () => {
    expect(parseBuilderCodes('0xdeadbeef')).toBeUndefined()
  })
  test('rejects empty, comma, non-ascii and overlong codes', () => {
    expect(() => assertBuilderCode('')).toThrow()
    expect(() => assertBuilderCode('a,b')).toThrow()
    expect(() => assertBuilderCode('vïbe')).toThrow()
    expect(() => assertBuilderCode('x'.repeat(256))).toThrow()
    expect(() => assertBuilderCode('demo')).not.toThrow()
  })
})
