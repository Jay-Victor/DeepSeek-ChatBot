import type { Nodes, Parent, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'

/**
 * 把回复正文转成适合朗读的纯文本。
 *
 * 在线朗读由服务端过滤 markdown（`filter_markdown: true`），本地引擎没有这一步：
 * 直接把 `**`、`\frac`、表格竖线念出来会很吵。这里复用渲染层同一套解析器取出文字，
 * 并按约定跳过代码块、表格、公式、图片与分割线；链接只读文字，裸 URL 去掉。
 */
const SKIP = new Set([
  'code',
  'math',
  'inlineMath',
  'table',
  'thematicBreak',
  'definition',
  'footnoteDefinition',
  'footnoteReference',
  'html',
  'image',
  'imageReference',
  'linkReference',
  'yaml',
  'toml',
])

/** 块级节点：前后各留一个换行，念的时候自然停顿 */
const BLOCK = new Set(['root', 'paragraph', 'heading', 'list', 'listItem', 'blockquote'])

const visit = (node: Nodes, out: string[]) => {
  switch (node.type) {
    case 'text':
      out.push(node.value)
      return
    case 'inlineCode':
      out.push(node.value)
      return
    case 'break':
      out.push('\n')
      return
    default:
      break
  }
  if (SKIP.has(node.type)) {
    return
  }
  if (!('children' in node)) {
    return
  }
  const block = BLOCK.has(node.type)
  if (block) {
    out.push('\n')
  }
  for (const child of (node as Parent).children) {
    visit(child, out)
  }
  if (block) {
    out.push('\n')
  }
}

const parse = (markdown: string): Root =>
  fromMarkdown(markdown, {
    extensions: [
      // 与 services/markdown/parse.ts 保持一致：缩进代码会吞掉前导空格的列表
      { ...gfm(), disable: { null: ['codeIndented'] } },
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })

export const toSpeakableText = (markdown: string): string => {
  if (!markdown.trim()) {
    return ''
  }
  let ast: Root
  try {
    ast = parse(markdown)
  } catch {
    // 解析失败时退回原文：念出符号也好过整条读不出来
    return markdown.trim()
  }
  const out: string[] = []
  visit(ast, out)
  return out
    .join('')
    .replace(/\[citation:\d+\]/g, '')
    .replace(/https?:\/\/[^\s)）\]】]+/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
