# claude-mods

A mod and a status line for [Claude Code](https://claude.com/claude-code).

| Part | What it does |
| --- | --- |
| [`cache-keepalive`](#cache-keepalive) | A mod, a plugin made of function hooks that runs inside every interactive session. Keeps an idle session's prompt cache warm, so coming back after a break doesn't pay to rebuild the whole context |
| [`statusline`](#status-line) | A status line: the model, context used, whether the prompt cache is still warm, and how much of the subscription limits is spent |

The code comments and the mod's status messages are in Russian.

## Set up with a prompt

Paste this into a Claude Code session, and it sets up both:

```
Set up https://github.com/nvinnikov/claude-mods for me:

1. Install the cache-keepalive plugin in user scope from a shell:
   claude plugin install cache-keepalive --marketplace nvinnikov/claude-mods --scope user
2. Download https://raw.githubusercontent.com/nvinnikov/claude-mods/main/statusline/statusline.py
   to ~/.claude/statusline.py and make it executable. If that file already exists,
   show me the diff and ask before replacing it.
3. In ~/.claude/settings.json set
   "statusLine": {"type": "command", "command": "~/.claude/statusline.py", "refreshInterval": 60}
   Read the file first and keep every other key. If a statusLine is already set,
   show it to me and ask before replacing it.
4. Check that python3 is on PATH, pipe a sample status line JSON into the script
   and show me what it prints.
5. Remind me that sessions already running pick up the plugin only after a restart
   (claude --continue).
```

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install cache-keepalive --marketplace nvinnikov/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads the mod in every new session).

From a shell:

```
claude plugin install cache-keepalive --marketplace nvinnikov/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `nvinnikov/claude-mods`, then Add plugin.

A session that is already running does not pick up a newly installed mod: restart it with `claude --continue` or `claude -r`.

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

## Status line

```
Opus 5.5 | ctx 21% | cache warm 59m · 98% hit | 5h 18% · 7d 0%
user@host:~/project (main)
```

- First line: the model; context used (red from 75%); `cache warm Nm` with the minutes left before the prompt cache expires, or `cache cold`, and the share of the last turn read from the cache; usage of the 5-hour and 7-day subscription windows (yellow from 50% with the time to reset, red from 80%).
- Second line: `user@host`, the folder and the git branch. A short machine name in `~/.claude/hostname` replaces the host name.
- It reads only what Claude Code passes to a status line command (`context_window`, `prompt_cache`, `rate_limits`) and needs `python3`. The usage part shows only when Claude Code passes `rate_limits`.
- It works without `cache-keepalive`. With it, `cache warm` stays on while you are away.

To install it by hand:

```
curl -fsSL https://raw.githubusercontent.com/nvinnikov/claude-mods/main/statusline/statusline.py -o ~/.claude/statusline.py
chmod +x ~/.claude/statusline.py
```

Then add this to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/statusline.py", "refreshInterval": 60 }
```

`refreshInterval` redraws the line every 60 seconds, so the cache countdown keeps moving while the session is idle.

## License

MIT
