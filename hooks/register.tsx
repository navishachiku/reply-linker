import type { EngineInterface, Register } from 'claude-code'

import { absolute, candidates, fileHref, linkify, parseFileHref } from './linkify.ts'
import { detect, fileCommands, urlCommands, type Command, type Options, type Platform } from './opener.ts'

type Found = { isDir: boolean }

// Paths that exist are remembered; missing ones are asked again next draw,
// since the reply may name a file the turn is about to write.
const found = new Map<string, Found>()
let platform: Platform | undefined

// A failed `uname` is not an answer: the guess for this call is Linux, but it
// is not remembered, so the next call asks again.
async function detectPlatform($: EngineInterface): Promise<{ platform: Platform; settled: boolean }> {
  const [wslDistro, os] = await Promise.all([$.env.get('WSL_DISTRO_NAME'), $.env.get('OS')])
  if (wslDistro || os === 'Windows_NT') return { platform: detect({ wslDistro, os }), settled: true }
  const uname = await $.process.run(['uname', '-s']).then(
    r => (r.exitCode === 0 ? r.stdout : ''),
    () => '',
  )
  return { platform: detect({ uname }), settled: uname.trim() !== '' }
}

async function platformOf($: EngineInterface): Promise<Platform> {
  if (platform) return platform
  const det = await detectPlatform($)
  if (det.settled) platform = det.platform
  return det.platform
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

// Why a command failed: the exit code with the start of its stderr, or the
// error that kept it from starting.
const REASON_CHARS = 120

function describe(r: { exitCode: number; stderr: string } | Error): string {
  if (r instanceof Error) return r.message
  const err = r.stderr.trim().replace(/\s+/g, ' ').slice(0, REASON_CHARS)
  return err ? `exit ${r.exitCode}: ${err}` : `exit ${r.exitCode}`
}

// Returns an empty list when a command opened the target, else one line per
// command that was tried.
async function run($: EngineInterface, commands: Command[]): Promise<string[]> {
  const failures: string[] = []
  for (const c of commands) {
    try {
      const r = await $.process.run(c.argv, { timeoutMs: 15000 })
      if (c.anyExit || r.exitCode === 0) return []
      failures.push(`${c.argv[0]}: ${describe(r)}`)
    } catch (e) {
      failures.push(`${c.argv[0]}: ${describe(e instanceof Error ? e : new Error(String(e)))}`)
    }
  }
  return failures
}

async function winPathOf($: EngineInterface, path: string): Promise<string | undefined> {
  const r = await $.process.run(['wslpath', '-w', path]).catch(() => undefined)
  return r?.exitCode === 0 ? r.stdout.trim() : undefined
}

async function open($: EngineInterface, href: string, opts: Options): Promise<void> {
  const p = await platformOf($)
  const file = parseFileHref(href)
  let failures: string[]
  if (!file) {
    failures = await run($, urlCommands(p, href, opts))
  } else {
    const isDir = (await lookup($, file.path))?.isDir ?? false
    const winPath = p === 'wsl' ? await winPathOf($, file.path) : undefined
    failures = await run($, fileCommands(p, { ...file, isDir, winPath }, opts))
  }
  if (failures.length > 0) {
    $.ui.toast(`reply-linker: could not open ${href}\n${failures.join('\n')}`, { timeoutMs: 15000 })
  }
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
