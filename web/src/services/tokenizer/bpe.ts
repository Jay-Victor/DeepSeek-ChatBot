/**
 * Byte-level BPE 计数，规则与 HuggingFace tokenizers 的
 * Split(Isolated) ×3 + ByteLevel + BPE 一致。
 *
 * 只统计 token 数，不产出 id：byte-level BPE 的 256 个基础符号一定在词表里，
 * 因此运行时不需要 128k 的 vocab，只需要 merges 与 added tokens。
 */

/** 可打印区间沿用 GPT-2 bytes_to_unicode；只有不在区间内的字节参与 256+n 编号 */
const isPrintable = (byte: number) =>
  (byte >= 33 && byte <= 126) || (byte >= 161 && byte <= 172) || (byte >= 174 && byte <= 255)

const BYTE_TO_CHAR: string[] = []
let extra = 0
for (let byte = 0; byte < 256; byte++) {
  BYTE_TO_CHAR.push(
    isPrintable(byte) ? String.fromCharCode(byte) : String.fromCharCode(256 + extra++)
  )
}

/**
 * tokenizer.json 的 pre_tokenizer 链，顺序不能改：
 * 数字按 1–3 位切开、CJK 逐段切开、再按 GPT 式符号/字母/空白规则切。
 * 三段都是 Split(behavior: Isolated)：匹配段与未匹配段都保留。
 */
const SPLITS = [
  /\p{N}{1,3}/gu,
  /[一-龥぀-ゟ゠-ヿ]+/gu,
  /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~][A-Za-z]+|[^\r\n\p{L}\p{P}\p{S}]?[\p{L}\p{M}]+| ?[\p{P}\p{S}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
]

const TEXT_ENCODER = new TextEncoder()

const splitIsolated = (regex: RegExp, text: string): string[] => {
  const pieces: string[] = []
  let last = 0
  regex.lastIndex = 0
  for (let match; (match = regex.exec(text)); ) {
    if (match.index > last) {
      pieces.push(text.slice(last, match.index))
    }
    pieces.push(match[0])
    last = match.index + match[0].length
    // 空匹配理论上不会出现；防止 lastIndex 不前进导致死循环
    if (match[0].length === 0) {
      regex.lastIndex++
    }
  }
  if (last < text.length) {
    pieces.push(text.slice(last))
  }
  return pieces
}

const toByteChars = (text: string): string => {
  let out = ''
  for (const byte of TEXT_ENCODER.encode(text)) {
    out += BYTE_TO_CHAR[byte]
  }
  return out
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type TokenCounter = (text: string) => number

/**
 * 用 merges 文本（每行 `left right`）与 specials 文本（每行一个 added token）建计数器。
 * 只保留 rank 表与特殊标记正则，不加载 vocab。
 */
export const createTokenCounter = (mergesText: string, specialsText: string): TokenCounter => {
  const ranks = new Map<string, number>()
  let rank = 0
  for (const line of mergesText.split('\n')) {
    if (!line) {
      continue
    }
    const space = line.indexOf(' ')
    if (space < 0) {
      continue
    }
    ranks.set(line.slice(0, space) + '\u0000' + line.slice(space + 1), rank)
    rank++
  }

  const bpeCount = (piece: string): number => {
    let symbols = Array.from(piece)
    if (symbols.length < 2) {
      return symbols.length
    }
    for (;;) {
      let bestRank = Number.POSITIVE_INFINITY
      let bestIndex = -1
      for (let index = 0; index + 1 < symbols.length; index++) {
        const mergeRank = ranks.get(symbols[index] + '\u0000' + symbols[index + 1])
        if (mergeRank !== undefined && mergeRank < bestRank) {
          bestRank = mergeRank
          bestIndex = index
        }
      }
      if (bestIndex < 0) {
        break
      }
      // 同一对在段内可能出现多次，必须一次全部合并，否则会多算
      const left = symbols[bestIndex]
      const right = symbols[bestIndex + 1]
      const merged: string[] = []
      for (let index = 0; index < symbols.length; ) {
        if (index + 1 < symbols.length && symbols[index] === left && symbols[index + 1] === right) {
          merged.push(left + right)
          index += 2
        } else {
          merged.push(symbols[index])
          index++
        }
      }
      symbols = merged
      if (symbols.length === 1) {
        break
      }
    }
    return symbols.length
  }

  const countPlain = (text: string): number => {
    if (!text) {
      return 0
    }
    let segments = [text]
    for (const regex of SPLITS) {
      segments = segments.flatMap((segment) => splitIsolated(regex, segment))
    }
    let total = 0
    for (const segment of segments) {
      total += bpeCount(toByteChars(segment))
    }
    return total
  }

  const specials = specialsText
    .split('\n')
    .filter((content) => content.length > 0)
    .sort((a, b) => b.length - a.length)
  // 必须用捕获组包住 alternation：String.split 会丢掉匹配到的特殊标记
  const specialRegex = specials.length
    ? new RegExp('(' + specials.map(escapeRegExp).join('|') + ')', 'g')
    : null

  return (text: string): number => {
    if (!text) {
      return 0
    }
    if (!specialRegex) {
      return countPlain(text)
    }
    let total = 0
    let last = 0
    for (const match of text.matchAll(specialRegex)) {
      total += countPlain(text.slice(last, match.index))
      // 每个特殊标记整体算一个 token
      total += 1
      last = match.index + match[0].length
    }
    return total + countPlain(text.slice(last))
  }
}
