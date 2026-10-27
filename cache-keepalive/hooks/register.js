// cache-keepalive: держит prompt cache простаивающей сессии тёплым.
// Включён по умолчанию; выключить — /keepalive off или CLAUDE_KEEPALIVE=0 при запуске claude.
// Пинг — $.model.fork: один запрос поверх кеша основной переписки; в саму переписку ничего не пишется.
// Кеш на подписке живёт 1 ч, поэтому пинг через 50 мин после последнего хода или пинга;
// после maxIdleHours простоя — стоп. Если кеш уже остыл, пинг не шлём (fork заплатил бы
// за всю переписку заново) и ждём следующего хода.
// Лог пингов: ~/.claude/cache-keepalive.log (read ≈ контекст значит «попал в кеш»).
// Время хода и пинга хранится в $.store по id сессии: горячая перезагрузка мода
// (правка файлов, /reload-plugins) не должна обнулять отсчёт TTL.

const MINUTE = 60_000
let INTERVAL_MIN = 50          // CLAUDE_KEEPALIVE_INTERVAL_MIN — для проверки
const COLD_MIN = 57          // столько минут без хода и пинга — кеш считаем остывшим
const MIN_CONTEXT = 20_000   // маленький контекст дешевле пересобрать, чем держать
const IDLE_COMPACT_MIN = 10  // раньше этого простоя 'precompute' — обычное сжатие у порога, не трогаем
const LOG_LINES = 300
const KEEP_DAYS = 3          // записи сессий в $.store старше этого удаляются

let enabled = true
let maxIdleHours = 8
let lastActivity = 0         // мс: последний настоящий ход (твой или агента)
let lastWarm = 0             // мс: последний ход или удачный пинг — от него считаем TTL кеша
let waitTurn = false         // пинговать нечего или кеш остыл — ждём следующего хода
let pings = 0                // пингов с последнего настоящего хода
let inTurn = false
let pinging = false
let logPath = ''
let ticker = null
let sid = ''

export function register(on) {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    lastActivity = lastWarm = now
    sid = await $.session.id()
    const home = await $.env.get('HOME')
    logPath = home ? home + '/.claude/cache-keepalive.log' : ''
    if ((await $.env.get('CLAUDE_KEEPALIVE')) === '0' || !e.isInteractive) enabled = false
    const iv = Number(await $.env.get('CLAUDE_KEEPALIVE_INTERVAL_MIN'))
    if (iv > 0) INTERVAL_MIN = iv
    await restore($, now)
    if (ticker) ticker.cancel()
    ticker = $.clock.every(MINUTE, () => tick($))
    showStatus($)
    try {
      await $.command.register({
        name: 'keepalive',
        description: 'Keep this session\'s prompt cache warm while idle',
        argumentHint: 'on [часов] | off | status | ping',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('не удалось добавить /keepalive: ' + err)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    inTurn = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    inTurn = false
    lastActivity = lastWarm = await $.clock.now()
    pings = 0
    waitTurn = false
    await save($)
    showStatus($)
    return next(e)
  })

  // Claude Code сжимает простаивающую переписку незадолго до того, как кеш остынет
  // (от 200k токенов, на 0.9 TTL ≈ 54 мин простоя; trigger бывает 'auto', бывает и 'precompute').
  // Пока keepalive пингует, кеш и так тёплый — такое сжатие только теряет детали.
  // Если пинги не идут (waitTurn), не мешаем: пусть Claude Code сожмёт как обычно.
  // 'precompute' бывает и у обычного сжатия у порога окна сразу после хода — его не трогаем.
  on('session.compact', async ($, e, next) => {
    if (enabled && !waitTurn && !inTurn && !e.agentId && (e.trigger === 'precompute' || e.trigger === 'auto')) {
      const now = await $.clock.now()
      const idleMin = (now - lastActivity) / MINUTE
      if (idleMin >= IDLE_COMPACT_MIN && idleMin <= maxIdleHours * 60) {
        await writeLog($, now, `сжатие в простое отклонено (trigger ${e.trigger}, простой ${Math.round(idleMin)} мин)`)
        return { skip: 'cache-keepalive держит кеш тёплым, сжатие в простое не нужно' }
      }
    }
    return next(e)
  })

  on('command.run', { command: 'keepalive' }, async ($, e) => {
    const [cmd, arg] = (e.args || '').trim().split(/\s+/)
    if (cmd === 'on') {
      const h = Number(arg)
      if (arg && h > 0) maxIdleHours = h
      enabled = true
      waitTurn = false
      await save($)
      showStatus($)
      return { text: `keepalive включён: пинг через ${INTERVAL_MIN} мин после хода или пинга, до ${maxIdleHours} ч простоя` }
    }
    if (cmd === 'off') {
      enabled = false
      await save($)
      showStatus($)
      return { text: 'keepalive выключен' }
    }
    if (cmd === 'ping') {
      if (pinging || inTurn) return { text: 'сейчас идёт ход или пинг, попробуй позже' }
      return { text: await ping($, await $.clock.now()) }
    }
    const now = await $.clock.now()
    const idle = Math.round((now - lastActivity) / MINUTE)
    const warm = Math.round((now - lastWarm) / MINUTE)
    return {
      text: enabled
        ? `keepalive включён · простой ${idle} мин · с последнего хода или пинга ${warm} мин · пингов ${pings}${waitTurn ? ' · ждёт следующего хода' : ''} · стоп после ${maxIdleHours} ч простоя · лог ${logPath}`
        : 'keepalive выключен (/keepalive on [часов])',
    }
  })
}

function showStatus($) {
  if (!enabled) return $.ui.status(undefined)
  $.ui.status(waitTurn ? 'keepalive ждёт хода' : `keepalive вкл · пингов ${pings}`)
}

async function tick($) {
  if (!enabled || waitTurn || inTurn || pinging) return
  const now = await $.clock.now()
  if ((now - lastActivity) / MINUTE > maxIdleHours * 60) return
  const sinceWarm = (now - lastWarm) / MINUTE
  if (sinceWarm < INTERVAL_MIN) return
  if (sinceWarm > COLD_MIN) {
    waitTurn = true
    await save($)
    await writeLog($, now, `кеш уже остыл (${Math.round(sinceWarm)} мин без хода и пинга), не пингую до следующего хода`)
    showStatus($)
    return
  }
  const usage = await $.session.usage()
  if ((usage.context.tokens || 0) < MIN_CONTEXT) return
  await ping($, now)
}

// Один пинг; возвращает строку для лога и /keepalive ping.
async function ping($, now) {
  pinging = true
  let line
  try {
    const tokens = (await $.session.usage()).context.tokens || 0
    const idleMin = Math.round((now - lastActivity) / MINUTE)
    const r = await $.model.fork({ prompt: 'keepalive-пинг от мода cache-keepalive: ответь одним словом ok, ничего не делай.' })
    const u = r.usage || {}
    const cost = `read ${u.cache_read_input_tokens || 0} · write ${u.cache_creation_input_tokens || 0} · in ${u.input_tokens || 0} · out ${u.output_tokens || 0}`
    if (r.isAnswered) {
      pings += 1
      lastWarm = await $.clock.now()
      const isCold = (u.cache_read_input_tokens || 0) < tokens / 2
      // fork на холодном кеше пишет свой отдельный кеш (инструменты запрещены), главная
      // переписка от него не теплеет: повторять нет смысла, ждём настоящего хода
      if (isCold) waitTurn = true
      line = `ping ${pings} · простой ${idleMin} мин · контекст ${tokens} · ${cost}${isCold ? ' · кеш был холодный, записан заново; больше не пингую до следующего хода' : ''}`
    } else if (r.reason === 'nothing-to-fork') {
      // после resume или /clear до первого хода форкать нечего
      waitTurn = true
      line = `нечего форкать (после resume или /clear не было хода), жду следующего хода · контекст ${tokens}`
    } else if (r.reason === 'api-error') {
      // следующий тик попробует снова; кеш при этом не продлился
      line = `пинг не прошёл: api-error ${r.status ?? 'нет ответа'} ${r.error} · простой ${idleMin} мин · ${cost}`
    } else {
      // empty-reply/aborted: запрос всё же ушёл поверх кеша
      if (r.reason === 'empty-reply') lastWarm = await $.clock.now()
      line = `пинг без ответа: ${r.reason} · простой ${idleMin} мин · ${cost}`
    }
  } catch (err) {
    line = 'ошибка: ' + err
  } finally {
    pinging = false
  }
  await save($)
  await writeLog($, now, line)
  showStatus($)
  return line
}

// Состояние этой сессии из $.store: после горячей перезагрузки мода или resume.
async function restore($, now) {
  try {
    const saved = await $.store.get('s:' + sid)
    if (saved && typeof saved === 'object') {
      if (saved.lastActivity > 0) lastActivity = saved.lastActivity
      if (saved.lastWarm > 0) lastWarm = saved.lastWarm
      if (typeof saved.enabled === 'boolean' && enabled) enabled = saved.enabled
      if (saved.maxIdleHours > 0) maxIdleHours = saved.maxIdleHours
      pings = saved.pings || 0
      waitTurn = !!saved.waitTurn
    } else {
      // записи нет (новая сессия или перезагрузка старой версии мода): возраст кеша
      // неизвестен, пинговать вслепую дорого — ждём первого хода
      waitTurn = true
    }
    for (const k of await $.store.keys()) {
      if (!k.startsWith('s:') || k === 's:' + sid) continue
      const v = await $.store.get(k)
      if (!v || !(v.lastActivity > now - KEEP_DAYS * 24 * 60 * MINUTE)) await $.store.delete(k)
    }
  } catch (err) {
    $.ui.log('keepalive: не удалось прочитать сохранённое состояние: ' + err)
  }
}

async function save($) {
  if (!sid) return
  try {
    await $.store.set('s:' + sid, { lastActivity, lastWarm, enabled, maxIdleHours, pings, waitTurn })
  } catch (err) {
    $.ui.log('keepalive: не удалось сохранить состояние: ' + err)
  }
}

async function writeLog($, now, line) {
  if (!logPath) return
  const cwd = await $.session.cwd()
  let old = ''
  try {
    if (await $.fs.exists(logPath)) old = await $.fs.read(logPath)
  } catch (err) {
    old = ''
  }
  const lines = old.split('\n').filter(Boolean).slice(-(LOG_LINES - 1))
  lines.push(`${new Date(now).toISOString()} ${sid.slice(0, 8)} ${cwd} · ${line}`)
  await $.fs.write(logPath, lines.join('\n') + '\n')
}
