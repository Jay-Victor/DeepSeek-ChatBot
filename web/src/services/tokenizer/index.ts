import mergesUrl from '../../assets/deepseek-v4-merges.txt'
import specialsUrl from '../../assets/deepseek-v4-specials.txt'
import { createTokenCounter, type TokenCounter } from './bpe.js'

export type { TokenCounter } from './bpe.js'

/**
 * 分词器资源约 1.5 MB（gzip ~0.7 MB），首次用到时再加载；失败不阻断聊天，
 * 下次挂载会重试。构建资源由 web/scripts/build-tokenizer-asset.mjs 从
 * tokenizer.json 生成（原始文件在 gitignored 的 references/ 里）。
 */
let counterPromise: Promise<TokenCounter> | null = null

const loadText = async (url: string): Promise<string> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`分词器资源加载失败：${response.status} ${url}`)
  }
  return response.text()
}

export const loadTokenCounter = (): Promise<TokenCounter> => {
  counterPromise ??= Promise.all([loadText(mergesUrl), loadText(specialsUrl)])
    .then(([merges, specials]) => createTokenCounter(merges, specials))
    .catch((error: unknown) => {
      counterPromise = null
      throw error
    })
  return counterPromise
}
