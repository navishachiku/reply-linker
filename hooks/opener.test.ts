import { describe, expect, test } from 'claude-code/testing'

import { detect, fileCommands, urlCommands } from './opener.ts'

const opts = { browser: 'chrome', editor: 'code' }

describe('urlCommands', () => {
  test('macOS opens the named app, then falls back to the default', () => {
    expect(urlCommands('macos', 'https://a.com', opts).map(c => c.argv)).toEqual([
      ['open', '-a', 'Google Chrome', 'https://a.com'],
      ['open', 'https://a.com'],
    ])
  })

  test('Windows and WSL quote the URL for PowerShell', () => {
    const [first] = urlCommands('wsl', "https://a.com/?q=it's&x=1", opts)
    expect(first!.argv).toEqual([
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Start-Process chrome -ArgumentList 'https://a.com/?q=it''s&x=1'",
    ])
  })

  test('a browser the platform lacks uses the default', () => {
    expect(urlCommands('windows', 'https://a.com', { ...opts, browser: 'safari' })).toHaveLength(1)
  })
})

describe('fileCommands', () => {
  test('jumps to the line in code, then falls back to the system opener', () => {
    expect(fileCommands('macos', { path: '/r/a.md', line: 4, isDir: false }, opts).map(c => c.argv)).toEqual([
      ['code', '-g', '/r/a.md:4'],
      ['open', '/r/a.md'],
    ])
  })

  test('Windows starts the editor through cmd and folders in Explorer', () => {
    expect(fileCommands('windows', { path: 'C:/w/a.md', isDir: false }, opts)[0]!.argv).toEqual([
      'cmd',
      '/c',
      'code',
      '-g',
      'C:/w/a.md',
    ])
    expect(fileCommands('windows', { path: 'C:/w', isDir: true }, opts)).toEqual([
      { argv: ['explorer.exe', 'C:\\w'], anyExit: true },
    ])
  })

  test('an editor without line support gets the path alone', () => {
    expect(fileCommands('linux', { path: '/a.md', line: 2, isDir: false }, { ...opts, editor: 'nvim-qt' })[0]!.argv).toEqual([
      'nvim-qt',
      '/a.md',
    ])
  })
})

test('detect', () => {
  expect(detect({ wslDistro: 'Ubuntu' })).toBe('wsl')
  expect(detect({ os: 'Windows_NT' })).toBe('windows')
  expect(detect({ uname: 'Darwin\n' })).toBe('macos')
  expect(detect({ uname: 'Linux\n' })).toBe('linux')
})
