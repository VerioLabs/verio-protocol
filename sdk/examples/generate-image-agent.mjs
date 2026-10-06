#!/usr/bin/env node
// An agent that finds an image generator on Verio, pays for one image in USDC over x402, and saves it.
//
//   (umask 077; node -e "const{generatePrivateKey:g,privateKeyToAccount:a}=require('viem/accounts');const k=g();console.log(JSON.stringify([{address:a(k).address,privateKey:k}]))" > wallets-agent.json)   # once; fund it with test USDC
//   node examples/generate-image-agent.mjs "a cat astronaut, watercolor" [--asset 0x…] [--max 20000] [--out image.png]
//
// env: VERIO_API (default https://www.verio.network), AGENT_WALLET (default wallets-agent.json)
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { discover, invoke } from '@veriolabs/sdk/agent'
import { privateKeyToAccount } from 'viem/accounts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    // A featured IP asset on Story mainnet whose image the Story API returns (IPPY's it does not).
    asset: { type: 'string', default: '0x0a0466c312687027E2BEa065d4Cca0DCEC19bb2C' },
    max: { type: 'string', default: '20000' },
    out: { type: 'string', default: 'image.png' },
  },
})
const prompt = positionals.join(' ')
if (!prompt) throw new Error('usage: generate-image-agent.mjs "<prompt>" [--asset 0x…] [--max 20000] [--out image.png]')

const api = process.env.VERIO_API ?? 'https://www.verio.network'
const [wallet] = JSON.parse(readFileSync(process.env.AGENT_WALLET ?? 'wallets-agent.json', 'utf8'))
const account = privateKeyToAccount(wallet.privateKey)
const maxAmount = BigInt(values.max)

// 1. Discover: image generators within budget, cheapest first, with an endpoint to call.
const found = (await discover(api, { capabilities: ['image-generation'], maxPrice: maxAmount, sort: 'price' })).filter((r) => r.endpoint)
if (!found.length) throw new Error(`no image generator at or under ${maxAmount} on ${api}`)
const r = found[0]
console.log(`found #${r.resourceId} ${r.name} (${r.metadataStatus}) for ${Number(r.price) / 1e6} USDC, paid to ${r.payee}`)
console.log(`  ${r.stats30d.calls} paid calls from ${r.stats30d.payers} agents in the last 30 days`)
const perf = r.performance30d
console.log(
  `  reputation ${r.reputation.score}/100; success ${perf.successRate === null ? 'unmeasured' : `${Math.round(perf.successRate * 100)}%`}` +
    (perf.latencyMs ? `, p50 ${(perf.latencyMs.p50 / 1000).toFixed(1)} s` : ''),
)

// 2–4. Verify against the registry, pay, invoke. `invoke` signs only an offer matching the registry.
console.log(`agent ${account.address} paying at most ${Number(maxAmount) / 1e6} USDC…`)
const started = Date.now()
const { result, payment } = await invoke({
  endpoint: r.endpoint,
  chainId: r.chainId,
  resourceId: r.resourceId,
  body: { prompt, assetId: values.asset },
  account,
  maxAmount,
})

const png = Buffer.from(result.image.replace(/^data:image\/\w+;base64,/, ''), 'base64')
writeFileSync(values.out, png)
const explorer = r.chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org'
console.log(`saved ${values.out} (${png.length} bytes, ${result.model}) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
console.log(`paid: ${explorer}/tx/${payment.transaction}`)
