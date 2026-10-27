# claude-mods

Two mods for [Claude Code](https://claude.com/claude-code): plugins made of function hooks that run inside every interactive session.

| Mod | What it does |
| --- | --- |
| [`titler`](#titler) | Keeps the session title, and its [herdr](https://herdr.dev) tab and workspace labels, on what the session is about right now |
| [`cache-keepalive`](#cache-keepalive) | Keeps an idle session's prompt cache warm, so coming back after a break doesn't pay to rebuild the whole context |

The code comments, status lines and the titles `titler` generates are in Russian.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install titler --marketplace nvinnikov/claude-mods
/plugin install cache-keepalive --marketplace nvinnikov/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads the mod in every new session).

From a shell:

```
claude plugin install titler --marketplace nvinnikov/claude-mods
claude plugin install cache-keepalive --marketplace nvinnikov/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `nvinnikov/claude-mods`, then Add plugin.

A session that is already running does not pick up a newly installed mod: restart it with `claude --continue` or `claude -r`.

## titler

Claude Code names a session from its first message, and the name never changes after that. herdr names workspaces after the folder (`services`, `services`, `services`…) and tabs by number. `titler` keeps both on the current topic.

- After a turn, at most once every 10 minutes per session, it sends the first message and the end of the conversation to Haiku. Haiku answers with a 2–5 word topic. It keeps a tracker key such as `ABC-123` while the session stays on that task.
- The topic becomes the session title on your next prompt. That title shows in the terminal title, herdr's agent list and the `claude -r` picker.
- Inside a herdr pane it also renames the tab, if that tab holds only this session, and the workspace, if that workspace holds only this session.
- It renames only labels nobody chose: a number, the folder name, Claude's own title, or a label `titler` set itself. Rename a label by hand and `titler` leaves it alone from then on.
- When a running session first gets the mod (after a restart or `--continue`), it names itself from the conversation it already has within about 20 seconds.

Commands:

| Command | Effect |
| --- | --- |
| `/title` | Status: current topic, when it was last computed |
| `/title <text>` or `/rename <text>` | Pin this name (session title and herdr labels); no more automatic updates |
| `/title auto` | Unpin, take the tab and workspace labels back, recompute now |
| `/title off` | Turn `titler` off for this session |

- Set `CLAUDE_TITLER=0` to disable it for a session at launch. `CLAUDE_TITLER_INTERVAL_MIN` overrides the 10-minute pause, which is handy for testing.
- Renames and errors go to `~/.claude/titler.log`.
- Each title is one Haiku call billed to the session's own credentials, a fraction of a cent.
- If you have a hook or script that renames herdr tabs to the session's `ai-title`, remove it: it will keep undoing `titler`.

## cache-keepalive

The prompt cache of a session on a Claude subscription lives about an hour. Come back later and the next turn pays to write the whole context again. `cache-keepalive` keeps the cache warm while you are away.

- 50 minutes after the last turn or ping it sends one tiny ping (`$.model.fork` over the session's own transcript; nothing is added to the conversation). It stops after 8 idle hours.
- If the cache has already gone cold (more than 57 minutes since the last turn or ping), it does not ping, because the ping would pay for a full write. It waits for your next turn instead.
- It skips sessions with less than 20k tokens of context, where rebuilding is cheap.
- While pings are running, it declines Claude Code's idle auto-compaction, which would otherwise throw detail away even though the cache is warm.

Commands: `/keepalive status`, `/keepalive on [hours]`, `/keepalive off`, `/keepalive ping` (one ping now).

- Set `CLAUDE_KEEPALIVE=0` to disable it at launch. `CLAUDE_KEEPALIVE_INTERVAL_MIN` changes the interval for testing.
- Pings are logged to `~/.claude/cache-keepalive.log`. A read close to the context size means a cache hit.
- Every ping is billed as a cache read of the whole context. Caches belong to an organization, so after switching accounts the first ping pays a full write.

## License

MIT
