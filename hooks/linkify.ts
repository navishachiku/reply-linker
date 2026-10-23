// Finds URLs and file paths in a reply's markdown and turns them into links.
// Pure text work: whether a path exists is decided by the caller.

export type Candidate = { kind: 'url'; url: string } | { kind: 'path'; path: string; line?: number }

type Segment = { text: string; kind: 'skip' | 'code' | 'plain' }

export type Resolve = (path: string, line?: number) => string | undefined

// Full-width brackets (\uFF08 \uFF09 \u300C \u300D) end a URL in CJK prose.
const URL_RE = /https?:\/\/[^\s<>`"'()\uFF08\uFF09\u300C\u300D\[\]]+/g
const NAME = String.raw`[\w@+-][\w.@+-]*\.\w+`
const DIRS = String.raw`(?:[\w.@+-]+[\\/])*`
// POSIX (`/a/b.md`, `~/b.md`, `./b.md`, `src/b.md`) or Windows (`C:\a\b.md`).
const PATH_BODY = String.raw`(?:[A-Za-z]:[\\/]${DIRS}${NAME}|(?:~|\.{1,2})?\/?${DIRS}${NAME})`
const LINE = String.raw`(?::(\d+)(?:[-:]\d+)?)?`
// `file://` before a path is part of the link text (`file:///D:/a.md` keeps the third slash with the drive).
const SCHEME = String.raw`(?:file:\/\/(?:\/(?=[A-Za-z]:[\\/]))?)?`
const PATH_RE = new RegExp(String.raw`(?<![\w/\\.:~-])${SCHEME}(${PATH_BODY})${LINE}(?![\w/\\])`, 'g')
const WHOLE_PATH_RE = new RegExp(String.raw`^${SCHEME}(${PATH_BODY})${LINE}$`)
// Sentence punctuation, ASCII and full-width (\u3002 \uFF0C \uFF1B \uFF1A \uFF01 \uFF1F).
const TRAILING = /[.,;:!?\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F]+$/

// Fenced blocks and existing links stay as written; inline code is linked
// only when the whole span is one path or URL.
export function split(text: string): Segment[] {
  const out: Segment[] = []
  const re = /```[\s\S]*?(?:```|$)|\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]+`/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), kind: 'plain' })
    const isCode = m[0].startsWith('`') && !m[0].startsWith('```')
    out.push({ text: m[0], kind: isCode ? 'code' : 'skip' })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: 'plain' })
  return out
}

// Plain text needs a directory part, so `v1.2` or `e.g.` stays text; inline
// code may hold a bare file name.
const hasDir = (path: string) => /[\\/]/.test(path)

function codeTarget(span: string): Candidate | undefined {
  const inner = span.slice(1, -1).trim()
  if (/^https?:\/\/\S+$/.test(inner)) return { kind: 'url', url: inner }
  const m = WHOLE_PATH_RE.exec(inner)
  return m ? { kind: 'path', path: m[1]!, line: m[2] ? Number(m[2]) : undefined } : undefined
}

export function candidates(text: string): Candidate[] {
  const out: Candidate[] = []
  for (const seg of split(text)) {
    if (seg.kind === 'skip') continue
    if (seg.kind === 'code') {
      const c = codeTarget(seg.text)
      if (c) out.push(c)
      continue
    }
    for (const m of seg.text.matchAll(URL_RE)) out.push({ kind: 'url', url: m[0].replace(TRAILING, '') })
    for (const m of seg.text.replace(URL_RE, ' ').matchAll(PATH_RE)) {
      if (hasDir(m[1]!)) out.push({ kind: 'path', path: m[1]!, line: m[2] ? Number(m[2]) : undefined })
    }
  }
  return out
}

// `resolve` maps a path as written to the href it links to, or undefined to
// leave it as text.
export function linkify(text: string, resolve: Resolve): string {
  return split(text)
    .map(seg => {
      if (seg.kind === 'skip') return seg.text
      if (seg.kind === 'plain') return linkPlain(seg.text, resolve)
      const c = codeTarget(seg.text)
      const href = c?.kind === 'url' ? c.url : c ? resolve(c.path, c.line) : undefined
      return href ? `[${seg.text}](${href})` : seg.text
    })
    .join('')
}

function linkPlain(text: string, resolve: Resolve): string {
  const parts: string[] = []
  let at = 0
  for (const m of text.matchAll(URL_RE)) {
    parts.push(linkPaths(text.slice(at, m.index), resolve))
    const url = m[0].replace(TRAILING, '')
    parts.push(`[${url}](${url})`, m[0].slice(url.length))
    at = m.index + m[0].length
  }
  parts.push(linkPaths(text.slice(at), resolve))
  return parts.join('')
}

function linkPaths(text: string, resolve: Resolve): string {
  return text.replace(PATH_RE, (whole, path: string, line?: string) => {
    if (!hasDir(path)) return whole
    const href = resolve(path, line ? Number(line) : undefined)
    return href ? `[${whole}](${href})` : whole
  })
}

const DRIVE = /^[A-Za-z]:[\\/]/

// Absolute path from a path as written, against the session's directory,
// with `/` separators (`C:/a/b.md` on Windows).
export function absolute(path: string, cwd: string, home: string | undefined): string | undefined {
  let p = path.replace(/\\/g, '/')
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (p === '~' || p.startsWith('~/')) {
    if (!home) return undefined
    p = home.replace(/\\/g, '/') + p.slice(1)
  } else if (!p.startsWith('/') && !DRIVE.test(p)) {
    p = `${base}/${p}`
  }
  const drive = DRIVE.test(p) ? p.slice(0, 2) : ''
  const out: string[] = []
  for (const part of p.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `${drive}/${out.join('/')}`
}

export function fileHref(abs: string, line?: number): string {
  const p = DRIVE.test(abs) ? `/${abs}` : abs
  return `file://${encodeURI(p)}${line ? `#L${line}` : ''}`
}

export function parseFileHref(href: string): { path: string; line?: number } | undefined {
  if (!href.startsWith('file://')) return undefined
  const [rest, frag] = href.slice('file://'.length).split('#')
  const line = frag && /^L\d+$/.test(frag) ? Number(frag.slice(1)) : undefined
  let path = decodeURI(rest!)
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
  return { path, line }
}
