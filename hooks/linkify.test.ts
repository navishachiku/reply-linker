import { describe, expect, test } from 'claude-code/testing'

import { absolute, candidates, fileHref, linkify, parseFileHref } from './linkify.ts'

const all = () => 'file:///x'

describe('linkify', () => {
  test('links bare URLs and keeps trailing punctuation outside', () => {
    expect(linkify('see https://a.com/x.', all)).toBe('see [https://a.com/x](https://a.com/x).')
  })

  test('links paths with a directory part and a line number', () => {
    const out = linkify('open src/a.ts:12 now', (p, l) => `file:///r/${p}#L${l}`)
    expect(out).toBe('open [src/a.ts:12](file:///r/src/a.ts#L12) now')
  })

  test('links a bare file name only inside inline code', () => {
    expect(linkify('README.md and `README.md`', all)).toBe('README.md and [`README.md`](file:///x)')
  })

  test('leaves fenced code, existing links and unresolved paths alone', () => {
    const text = '```\n/tmp/a.md\n```\n[doc](https://a.com) docs/missing.md'
    expect(linkify(text, () => undefined)).toBe(text)
  })

  test('does not take version numbers or abbreviations for paths', () => {
    expect(candidates('v1.2.3 e.g. node 18.x')).toEqual([])
  })

  test('finds Windows paths', () => {
    expect(candidates('see C:\\work\\a.md:3')).toEqual([{ kind: 'path', path: 'C:\\work\\a.md', line: 3 }])
  })
})

describe('file:// paths', () => {
  const R = (p: string) => (p.endsWith('README.md') ? 'file:///x' : undefined)

  test('links a file:/// path including the scheme, and finds its path', () => {
    expect(candidates('open file:///Users/a/README.md now')).toEqual([{ kind: 'path', path: '/Users/a/README.md', line: undefined }])
    expect(linkify('open file:///Users/a/README.md now', R)).toBe('open [file:///Users/a/README.md](file:///x) now')
    expect(linkify('open `file:///Users/a/README.md`', R)).toBe('open [`file:///Users/a/README.md`](file:///x)')
  })

  test('plain paths, URLs and a colon-prefixed look-alike are unchanged', () => {
    expect(linkify('see https://a.com/x.', R)).toBe('see [https://a.com/x](https://a.com/x).')
    expect(linkify('see /Users/a/README.md', R)).toBe('see [/Users/a/README.md](file:///x)')
    expect(candidates('see ffile:///Users/a/README.md')).toEqual([])
  })

  test('drive-letter form links; wsl.localhost form is found but resolves as a relative path (no link on macOS)', () => {
    expect(candidates('file:///D:/work/a.md')).toEqual([{ kind: 'path', path: 'D:/work/a.md', line: undefined }])
    expect(candidates('file://wsl.localhost/Ubuntu/home/a.md')).toEqual([
      { kind: 'path', path: 'wsl.localhost/Ubuntu/home/a.md', line: undefined },
    ])
  })
})

describe('paths', () => {
  test('resolves relative, home and parent parts', () => {
    expect(absolute('../b/c.md', '/r/a', '/h')).toBe('/r/b/c.md')
    expect(absolute('~/c.md', '/r', '/h')).toBe('/h/c.md')
    expect(absolute('a\\b.md', 'C:\\work', undefined)).toBe('C:/work/a/b.md')
  })

  test('round-trips a file href with spaces and a line', () => {
    const href = fileHref('/r/my doc.md', 7)
    expect(href).toBe('file:///r/my%20doc.md#L7')
    expect(parseFileHref(href)).toEqual({ path: '/r/my doc.md', line: 7 })
    expect(parseFileHref(fileHref('C:/w/a.md'))).toEqual({ path: 'C:/w/a.md', line: undefined })
  })
})
