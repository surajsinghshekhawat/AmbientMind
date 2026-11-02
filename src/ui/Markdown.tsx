import type { ReactNode } from 'react'

/**
 * The little Markdown a local model actually writes: paragraphs, bullet and
 * numbered lists, **bold**, *italic*, `code` and links. Built as React
 * elements, never as HTML from the model.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g
  let last = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const token = match[0]
    if (match.index > last) out.push(text.slice(last, match.index))
    const key = `${keyBase}-${index++}`
    if (token.startsWith('**')) out.push(<strong key={key} className="font-semibold text-ink-1">{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) out.push(<code key={key} className="rounded-[5px] bg-fill-2 px-1 font-mono text-[0.92em]">{token.slice(1, -1)}</code>)
    else if (token.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? []
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {label}
        </a>
      )
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] }

function blocks(source: string): Block[] {
  const out: Block[] = []
  for (const raw of source.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const last = out.at(-1)
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      const item = (bullet ?? numbered)![1]!
      if (last && last.kind === kind) last.items.push(item)
      else out.push({ kind, items: [item] })
    } else if (!line.trim()) {
      out.push({ kind: 'p', lines: [] })
    } else if (last?.kind === 'p') {
      last.lines.push(line.replace(/^#+\s*/, ''))
    } else {
      out.push({ kind: 'p', lines: [line.replace(/^#+\s*/, '')] })
    }
  }
  return out.filter((block) => (block.kind === 'p' ? block.lines.length > 0 : true))
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-2.5 [overflow-wrap:anywhere]">
      {blocks(source).map((block, i) => {
        if (block.kind === 'p') return <p key={i}>{inline(block.lines.join(' '), `p${i}`)}</p>
        const List = block.kind
        return (
          <List key={i} className={`flex flex-col gap-1 pl-5 marker:text-ink-3 ${List === 'ul' ? 'list-disc' : 'list-decimal'}`}>
            {block.items.map((item, j) => (
              <li key={j} className="pl-1">
                {inline(item, `l${i}-${j}`)}
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
