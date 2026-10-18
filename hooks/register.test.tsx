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
