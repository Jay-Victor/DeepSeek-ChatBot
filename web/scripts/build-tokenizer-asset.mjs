#!/usr/bin/env node
/**
 * 从 tokenizer.json 生成运行时需要的两个最小资源：merges 与 specials。
 * 计数不需要 vocab：byte-level BPE 的 256 个基础符号一定存在，最终符号数就是 token 数。
 *
 * 用法：node web/scripts/build-tokenizer-asset.mjs [tokenizer.json 路径]
 * 默认读取 references/deepseek_v4_tokenizer/tokenizer.json（该目录不进版本库）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')
const defaultSource = path.resolve(webRoot, '../references/deepseek_v4_tokenizer/tokenizer.json')
const source = process.argv[2] ?? defaultSource

const tokenizer = JSON.parse(readFileSync(source, 'utf8'))
if (tokenizer.model?.type !== 'BPE') {
  throw new Error(`不支持的 model.type：${tokenizer.model?.type}`)
}

const merges = tokenizer.model.merges ?? []
const specials = (tokenizer.added_tokens ?? [])
  .map((token) => token.content)
  .filter((content) => typeof content === 'string' && content.length > 0)

for (const [name, values] of [
  ['merges', merges],
  ['added_tokens', specials],
]) {
  for (const value of values) {
    if (typeof value !== 'string' || value.includes('\n') || value.includes('\r')) {
      throw new Error(`${name} 含无法按行存储的内容`)
    }
  }
}
for (const merge of merges) {
  if (merge.indexOf(' ') < 0) {
    throw new Error(`merge 缺少分隔空格：${JSON.stringify(merge)}`)
  }
}

const mergesPath = path.join(webRoot, 'src/assets/deepseek-v4-merges.txt')
const specialsPath = path.join(webRoot, 'src/assets/deepseek-v4-specials.txt')
writeFileSync(mergesPath, `${merges.join('\n')}\n`)
writeFileSync(specialsPath, `${specials.join('\n')}\n`)

console.log(
  `merges ${merges.length} 条，${readFileSync(mergesPath).byteLength} B → ${path.relative(webRoot, mergesPath)}`
)
console.log(
  `specials ${specials.length} 条，${readFileSync(specialsPath).byteLength} B → ${path.relative(webRoot, specialsPath)}`
)
