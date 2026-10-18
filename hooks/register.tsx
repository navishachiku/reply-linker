import type { EngineInterface, Register } from 'claude-code'

import { absolute, candidates, fileHref, linkify, parseFileHref } from './linkify.ts'
import { detect, fileCommands, urlCommands, type Command, type Options, type Platform } from './opener.ts'

type Found = { isDir: boolean }

// Paths that exist are remembered; missing ones are asked again next draw,
// since the reply may name a file the turn is about to write.
const found = new Map<string, Found>()
let platform: Promise<Platform> | undefined

async function detectPlatform($: EngineInterface): Promise<Platform> {
  const [wslDistro, os] = await Promise.all([$.env.get('WSL_DISTRO_NAME'), $.env.get('OS')])
  if (wslDistro || os === 'Windows_NT') return detect({ wslDistro, os })
  const uname = await $.process.run(['uname', '-s']).then(
    r => r.stdout,
    () => '',
  )
  return detect({ uname })
}

function platformOf($: EngineInterface): Promise<Platform> {
  return (platform ??= detectPlatform($))
}

async function lookup($: EngineInterface, abs: string): Promise<Found | undefined> {
  const hit = found.get(abs)
  if (hit) return hit
  const stat = await $.fs.stat(abs).catch(() => undefined)
  if (!stat || stat.kind === 'other') return undefined
  const entry = { isDir: stat.kind === 'dir' }
  found.set(abs, entry)
  return entry
}

async function run($: EngineInterface, commands: Command[]): Promise<boolean> {
  for (const c of commands) {
    const r = await $.process.run(c.argv, { timeoutMs: 15000 }).catch(() => undefined)
    if (r && (c.anyExit || r.exitCode === 0)) return true
  }
  return false
}

async function winPathOf($: EngineInterface, path: string): Promise<string | undefined> {
  const r = await $.process.run(['wslpath', '-w', path]).catch(() => undefined)
  return r?.exitCode === 0 ? r.stdout.trim() : undefined
}

async function open($: EngineInterface, href: string, opts: Options): Promise<void> {
  const p = await platformOf($)
  const file = parseFileHref(href)
  let ok: boolean
  if (!file) {
    ok = await run($, urlCommands(p, href, opts))
  } else {
    const isDir = (await lookup($, file.path))?.isDir ?? false
    const winPath = p === 'wsl' ? await winPathOf($, file.path) : undefined
    ok = await run($, fileCommands(p, { ...file, isDir, winPath }, opts))
  }
  if (!ok) $.ui.toast(`reply-linker: could not open ${href}`)
}

// Hrefs for the paths in `text` that exist, keyed by path and line as written.
async function resolvePaths($: EngineInterface, text: string): Promise<Map<string, string>> {
  const [cwd, home, userProfile] = await Promise.all([$.session.cwd(), $.env.get('HOME'), $.env.get('USERPROFILE')])
  const hrefs = new Map<string, string>()
  for (const c of candidates(text)) {
    if (c.kind !== 'path') continue
    const abs = absolute(c.path, cwd, home ?? userProfile)
    if (abs && (await lookup($, abs))) hrefs.set(`${c.path}:${c.line ?? ''}`, fileHref(abs, c.line))
  }
  return hrefs
}

export const register: Register = (on, options) => {
  const opts: Options = {
    browser: typeof options.browser === 'string' ? options.browser : 'system',
    editor: typeof options.editor === 'string' ? options.editor : 'code',
  }

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const cands = candidates(e.props.text)
    if (cands.length === 0) return next(e)

    const hrefs = await resolvePaths($, e.props.text)
    if (hrefs.size === 0 && !cands.some(c => c.kind === 'url')) return next(e)

    const text = linkify(e.props.text, (path, line) => hrefs.get(`${path}:${line ?? ''}`))
    const bullet = (await platformOf($)) === 'macos' ? '⏺' : '●'
    const { Box, Text, Markdown } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Box minWidth={2}>
          <Text>{e.props.isFirstOfReply ? bullet : ' '}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Markdown key={`reply-${e.requestId}`} text={text} onLinkPress={link => open($, link.href, opts)} />
        </Box>
      </Box>
    )
  })
}
