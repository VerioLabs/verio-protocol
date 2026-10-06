import type { Hex } from 'viem'

/** ERC-8021 marker that terminates every attribution suffix. */
export const ERC8021_MARKER = '0x80218021802180218021802180218021' as const

/** A Builder Code is 1–255 bytes of printable ASCII without commas (comma delimits multiple codes). */
export function assertBuilderCode(code: string): void {
  if (code.length === 0 || code.length > 255)
    throw new Error(`builder code must be 1–255 bytes, got ${code.length}`)
  if (!/^[\x21-\x7e]+$/.test(code))
    throw new Error('builder code must be printable ASCII without spaces')
  if (code.includes(','))
    throw new Error('builder code must not contain a comma')
}

/** Schema-0 suffix: `codes ∥ codesLength(1) ∥ 0x00 ∥ marker(16)`. Append to calldata; contracts ignore it. */
export function builderCodeSuffix(code: string): Hex {
  assertBuilderCode(code)
  const codeHex = Array.from(code, (c) =>
    c.charCodeAt(0).toString(16).padStart(2, '0'),
  ).join('')
  const length = code.length.toString(16).padStart(2, '0')
  return `0x${codeHex}${length}00${ERC8021_MARKER.slice(2)}`
}

/** `data` with the Builder Code suffix appended, or unchanged when `code` is empty. */
export const withBuilderCode = (data: Hex, code: string): Hex =>
  code ? (`${data}${builderCodeSuffix(code).slice(2)}` as Hex) : data

/** Codes carried by `data`, or undefined when it has no schema-0 ERC-8021 suffix. */
export function parseBuilderCodes(data: Hex): readonly string[] | undefined {
  const hex = data.slice(2).toLowerCase()
  const marker = ERC8021_MARKER.slice(2)
  if (hex.length < marker.length + 4 || !hex.endsWith(marker)) return undefined
  const body = hex.slice(0, -marker.length)
  if (body.slice(-2) !== '00') return undefined
  const rest = body.slice(0, -2)
  const length = parseInt(rest.slice(-2), 16)
  if (length === 0 || rest.length < 2 + length * 2) return undefined
  const codesHex = rest.slice(-2 - length * 2, -2)
  const codes = codesHex
    .match(/.{2}/g)!
    .map((b) => String.fromCharCode(parseInt(b, 16)))
    .join('')
  return codes.split(',')
}
