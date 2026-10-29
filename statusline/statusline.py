#!/usr/bin/env python3
# Status line Claude Code (две строки):
#   Opus 5.5 | ctx 21% | cache warm 59m · 98% hit | 5h 18% · 7d 0%
#   user@host:~/project (main)
# JSON на stdin (см. /statusline). Кеш и лимиты подписки берутся из полей самого
# Claude Code (prompt_cache, rate_limits).
import json, sys, os, subprocess, time, socket, getpass

C = lambda code, s: f"\033[{code}m{s}\033[0m"
BLUE, MAG, YEL, DIM, GRN, RED = "34", "35", "33", "2", "32", "31"

d = json.load(sys.stdin)
model = d.get("model", {}).get("display_name", "?")
cwd = d.get("workspace", {}).get("current_dir") or os.getcwd()
now = time.time()

# --- контекст ---
ctx = d.get("context_window", {})
pct = ctx.get("used_percentage")

# --- кеш: warm/expires_at считает сам Claude Code, hit_ratio — доля из кеша в последнем ходе ---
pc = d.get("prompt_cache") or {}
exp = pc.get("expires_at")
left = int((exp - now) / 60) if exp else None
if pc.get("warm") and left and left > 0:
    cache = C(YEL, f"cache warm {left}m")
else:
    cache = C(RED, "cache cold")
hit = pc.get("hit_ratio")
if hit is not None:
    cache += C(DIM, f" · {hit * 100:.0f}% hit")

# --- лимиты подписки: сколько съедено от 5-часового и недельного окна ---
def window(label, w):
    p = (w or {}).get("used_percentage")
    if p is None:
        return None
    col = RED if p >= 80 else (YEL if p >= 50 else GRN)
    s = C(col, f"{label} {p:.0f}%")
    r = w.get("resets_at")
    if r and p >= 50:  # когда уже прилично съедено — показать, когда окно сбросится
        m = int((r - now) / 60)
        s += C(DIM, f" (↻{m // 60}ч{m % 60:02d})" if m >= 60 else f" (↻{max(m, 0)}м)")
    return s

rl = d.get("rate_limits") or {}
usage = [x for x in (window("5h", rl.get("five_hour")), window("7d", rl.get("seven_day"))) if x]

parts = [C(BLUE, model)]
if pct is not None:
    parts.append(C(RED if pct >= 75 else MAG, f"ctx {pct:.0f}%"))
parts.append(cache)
if usage:
    parts.append(C(DIM, " · ").join(usage))
line1 = C(DIM, " | ").join(parts)

# --- вторая строка: user@host:path (branch) ---
try:
    br = subprocess.run(["git", "-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"],
                        capture_output=True, text=True, timeout=1).stdout.strip()
except Exception:
    br = ""
home = os.path.expanduser("~")
path = "~" + cwd[len(home):] if cwd.startswith(home) else cwd
host = socket.gethostname().split(".")[0]
try: host = open(os.path.expanduser("~/.claude/hostname")).read().strip() or host  # короткое имя машины
except OSError: pass
line2 = C(GRN, f"{getpass.getuser()}@{host}") + C(DIM, ":") + C(BLUE, path)
if br:
    line2 += " " + C(YEL, f"({br})")

print(line1)
print(line2)
