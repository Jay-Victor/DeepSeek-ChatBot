#!/usr/bin/env node
/**
 * 用 Python tokenizers 生成的夹具校验 bpe.ts 的计数是否与 HF 完全一致。
 * 用法：node scripts/verify-tokenizer.mjs [fixtures.json]
 * 夹具来自 web/scripts/tokenizer-fixtures.json；可换成随机 fuzz 结果。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')
const fixturePath = process.argv[2] ?? path.join(here, 'tokenizer-fixtures.json')

const { createTokenCounter } = await import(
  new URL('../src/services/tokenizer/bpe.ts', import.meta.url).href
)
const merges = readFileSync(path.join(webRoot, 'src/assets/deepseek-v4-merges.txt'), 'utf8')
const specials = readFileSync(path.join(webRoot, 'src/assets/deepseek-v4-specials.txt'), 'utf8')
const count = createTokenCounter(merges, specials)

const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'))
let failed = 0
let chars = 0
const started = performance.now()
for (const fixture of fixtures) {
  const got = count(fixture.text)
  chars += fixture.text.length
  if (got !== fixture.count) {
    failed++
    console.log(
      `MISMATCH expected ${fixture.count}, got ${got}: ${JSON.stringify(fixture.text).slice(0, 80)}`
    )
  }
}
const elapsed = performance.now() - started
console.log(
  `${fixtures.length} fixtures, ${failed} mismatches, ${chars} chars, ${elapsed.toFixed(1)} ms`
)
process.exitCode = failed === 0 ? 0 : 1
