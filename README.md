# claude-mods

A mod for [Claude Code](https://claude.com/claude-code): a plugin made of function hooks that runs inside every interactive session.

| Mod | What it does |
| --- | --- |
| [`cache-keepalive`](#cache-keepalive) | Keeps an idle session's prompt cache warm, so coming back after a break doesn't pay to rebuild the whole context |

The code comments and status lines are in Russian.

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

## License

MIT
