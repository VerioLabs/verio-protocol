import type { Hex } from 'viem'

/** sha256 of the content bytes as a bytes32 hex — the value passed to `prove`. Works in browsers and Node ≥ 20. */
export async function contentHash(
  bytes: Uint8Array | ArrayBuffer,
): Promise<Hex> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes),
  )
  let hex = '0x'
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0')
  return hex as Hex
}
