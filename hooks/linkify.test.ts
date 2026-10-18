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
