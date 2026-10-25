import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const FILES: Record<string, 'file' | 'dir'> = { '/repo/docs/a.md': 'file' }

// The engine's own drawing, beneath the plugin.
function engineDraws(on: On) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const reply = (text: string) => ({
  plugin: 'reply-linker',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
})

test('a link press runs the editor at the line', async ($, on) => {
  const ran: string[][] = []
  engineDraws(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.stat', ($, e) => {
    // Windows hands the path over as `C:\repo\docs\a.md`.
    const kind = FILES[e.path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')]
    return kind ? { value: { kind, size: 1, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }
  })
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Darwin\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const ui = await $.ui.mount(reply('Edited docs/a.md:3 and docs/gone.md'))
  const md = await ui.find({ type: 'Markdown' })
  expect(md?.text).toBe('Edited [docs/a.md:3](file:///repo/docs/a.md#L3) and docs/gone.md')

  await ui.press({ key: md!.key!, link: { href: 'file:///repo/docs/a.md#L3' } })
  expect(ran).toContainEqual(['code', '-g', '/repo/docs/a.md:3'])
})

test('a reply with nothing to link is drawn by the engine', async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount(reply('Nothing here.'))
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

function failingSetup(on: On, toasts: string[], failure: (argv: readonly string[]) => object) {
  engineDraws(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.stat', ($, e) =>
    e.path === '/repo/docs/a.md' ? { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' },
  )
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'uname') {
      return { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return failure(e.argv)
  })
}

test('when every command fails the toast names each one and why', async ($, on) => {
  const toasts: string[] = []
  failingSetup(on, toasts, argv =>
    argv[0] === 'code'
      ? { deny: 'spawn code ENOENT' }
      : { value: { exitCode: 1, stdout: '', stderr: 'permission denied\n', isStdoutTruncated: false, isStderrTruncated: false } },
  )

  const ui = await $.ui.mount(reply('Edited docs/a.md'))
  const md = await ui.find({ type: 'Markdown' })
  await ui.press({ key: md!.key!, link: { href: 'file:///repo/docs/a.md' } })

  const toast = toasts.join('\n')
  expect(toast).toContain('could not open file:///repo/docs/a.md')
  expect(toast).toContain('code')
  expect(toast).toContain('spawn code ENOENT')
  expect(toast).toContain('open')
  expect(toast).toContain('exit 1: permission denied')
})

test('a command that succeeds shows no toast', async ($, on) => {
  const toasts: string[] = []
  failingSetup(on, toasts, () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  const ui = await $.ui.mount(reply('Edited docs/a.md'))
  const md = await ui.find({ type: 'Markdown' })
  await ui.press({ key: md!.key!, link: { href: 'file:///repo/docs/a.md' } })
  expect(toasts).toEqual([])
})

test('a failed platform probe is asked again on the next press', async ($, on) => {
  const ran: string[][] = []
  let unameWorks = false
  engineDraws(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.stat', ($, e) =>
    e.path === '/repo/docs/a.md' ? { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' },
  )
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    if (e.argv[0] === 'uname') {
      return unameWorks
        ? { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
        : { deny: 'timed out' }
    }
    // Only the macOS system opener succeeds.
    const ok = e.argv[0] === 'open'
    return { value: { exitCode: ok ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const ui = await $.ui.mount(reply('Edited docs/a.md'))
  const md = await ui.find({ type: 'Markdown' })
  const press = () => ui.press({ key: md!.key!, link: { href: 'file:///repo/docs/a.md' } })

  await press()
  expect(ran).toContainEqual(['xdg-open', '/repo/docs/a.md'])
  expect(ran).not.toContainEqual(['open', '/repo/docs/a.md'])

  unameWorks = true
  await press()
  expect(ran).toContainEqual(['open', '/repo/docs/a.md'])
})
