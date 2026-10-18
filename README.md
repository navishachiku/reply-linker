# reply-linker

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Claude Code 2.1.302+](https://img.shields.io/badge/claude%20code-2.1.302%2B-d97757)
![Platforms](https://img.shields.io/badge/platforms-macOS-informational)

Claude prints a URL or a file path, and you copy it, switch windows, and
paste it somewhere. This mod makes them links: one click opens the URL in the
browser you chose and the file in your editor, at the line Claude named.

- **URLs** — `https://…` opens in the system browser, or the one you pick.
- **Files** — `docs/a.md:3`, `~/notes.md`, `C:\work\a.md` open in VS Code at
  line 3. Paths are linked only when the file exists, relative ones against
  the session's directory.
- **Folders** — open in Finder or Explorer.
- **Hands off code** — fenced blocks and links Claude already wrote stay as
  they are. A reply with nothing to link is drawn by Claude as usual.

It needs Claude Code's fullscreen layout (`"tui": "fullscreen"`), where a
plain click reaches the mod. Ctrl-click still opens a link the terminal's way.

## Install

From a clone of this repository, in a shell:

```sh
claude plugin install reply-linker --marketplace /path/to/reply-linker
```

## Configuration

Set them with `/plugin configure reply-linker@reply-linker` in Claude Code,
or `--config KEY=VALUE` on `claude plugin install`:

| Setting | Default | Values |
| --- | --- | --- |
| Browser | `system` | `system`, `chrome`, `safari`, `edge`, `firefox` |
| Editor command | `code` | any command; `code`, `cursor`, `windsurf`, `codium` also jump to the line |

If the chosen app fails to start, the link falls back to the system opener,
and a toast says so when nothing could open it.

## Platforms

| Platform | URLs | Files |
| --- | --- | --- |
| macOS | `open -a <browser>` | editor, then `open` |
| WSL | Windows browser via `powershell.exe` | editor, then Windows Explorer |
| Linux | `<browser>` or `xdg-open` | editor, then `xdg-open` |
| Windows | `Start-Process` | editor via `cmd`, then Explorer |

Tested on macOS. On a Windows machine running Claude inside Herdr, both
native Windows and WSL draw the links and react to hover, but a plain click
does not reach the mod yet.

## Development

```sh
claude --plugin-dir ./reply-linker
claude plugin test ./reply-linker
```

`hooks/linkify.ts` finds and links paths, `hooks/opener.ts` builds the open
commands per platform, and `hooks/register.tsx` draws replies and handles
clicks. Each has its tests beside it.

## License

[MIT](LICENSE)
