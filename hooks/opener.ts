// Which commands open a link on each platform. Each target lists commands
// tried in order until one starts and exits cleanly.

export type Platform = 'macos' | 'windows' | 'wsl' | 'linux'

export type Options = { browser: string; editor: string }

// `explorer.exe` exits 1 even when it opened the target.
export type Command = { argv: string[]; anyExit?: boolean }

const MAC_APPS: Record<string, string> = {
  chrome: 'Google Chrome',
  safari: 'Safari',
  edge: 'Microsoft Edge',
  firefox: 'Firefox',
}
const WIN_EXES: Record<string, string> = { chrome: 'chrome', edge: 'msedge', firefox: 'firefox' }
const LINUX_BINS: Record<string, string> = { chrome: 'google-chrome', edge: 'microsoft-edge', firefox: 'firefox' }

// Editors that take `-g file:line` to jump to a line.
const GOTO_EDITORS = new Set(['code', 'code-insiders', 'cursor', 'windsurf', 'codium'])

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`

function powershell(script: string, exe: string): Command {
  return { argv: [exe, '-NoProfile', '-NonInteractive', '-Command', script] }
}

export function urlCommands(platform: Platform, url: string, opts: Options): Command[] {
  const b = opts.browser
  switch (platform) {
    case 'macos':
      return MAC_APPS[b] ? [{ argv: ['open', '-a', MAC_APPS[b]!, url] }, { argv: ['open', url] }] : [{ argv: ['open', url] }]
    case 'windows':
    case 'wsl': {
      const exe = platform === 'wsl' ? 'powershell.exe' : 'powershell'
      const system = powershell(`Start-Process ${psQuote(url)}`, exe)
      return WIN_EXES[b] ? [powershell(`Start-Process ${WIN_EXES[b]} -ArgumentList ${psQuote(url)}`, exe), system] : [system]
    }
    case 'linux':
      return LINUX_BINS[b] ? [{ argv: [LINUX_BINS[b]!, url] }, { argv: ['xdg-open', url] }] : [{ argv: ['xdg-open', url] }]
  }
}

function editorArgv(platform: Platform, editor: string, path: string, line?: number): string[] {
  const words = editor.trim().split(/\s+/)
  const name = words[0]!.replace(/\.(cmd|exe)$/i, '').split(/[\\/]/).pop()!
  const args = GOTO_EDITORS.has(name) ? ['-g', line ? `${path}:${line}` : path] : [path]
  // `code` is a .cmd script on Windows, which only cmd can start.
  return platform === 'windows' ? ['cmd', '/c', ...words, ...args] : [...words, ...args]
}

// `isDir` folders go to the file manager; files to the editor first. On WSL
// the file manager is Windows', so the path is converted with `winPath`.
export function fileCommands(
  platform: Platform,
  target: { path: string; line?: number; isDir: boolean; winPath?: string },
  opts: Options,
): Command[] {
  const system: Command[] = {
    macos: [{ argv: ['open', target.path] }],
    windows: [{ argv: ['explorer.exe', target.path.replace(/\//g, '\\')], anyExit: true }],
    wsl: target.winPath ? [{ argv: ['explorer.exe', target.winPath], anyExit: true }] : [{ argv: ['xdg-open', target.path] }],
    linux: [{ argv: ['xdg-open', target.path] }],
  }[platform]
  if (target.isDir || !opts.editor.trim()) return system
  return [{ argv: editorArgv(platform, opts.editor, target.path, target.line) }, ...system]
}

export function detect(env: { wslDistro?: string; os?: string; uname?: string }): Platform {
  if (env.wslDistro) return 'wsl'
  if (env.os === 'Windows_NT') return 'windows'
  return env.uname?.trim() === 'Darwin' ? 'macos' : 'linux'
}
