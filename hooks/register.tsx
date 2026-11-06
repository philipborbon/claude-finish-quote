import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FinishQuote } from '../types'

// The quote list, downloaded from dwyl/quotes when the mod first starts (setup) and
// refreshed weekly, kept in the mod's own store between sessions.
const SOURCE = 'https://raw.githubusercontent.com/dwyl/quotes/main/quotes.json'
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000
// Quotes kept for scrolling back; older turns lose theirs.
const KEEP = 200
// How far the line's duration may differ from turn.complete's and still be the same turn.
const MATCH_MS = 1500

const quotes = atom({ plugin: 'finish-quote', key: 'quotes' } as const, [] as FinishQuote[])

type Raw = { text?: unknown; author?: unknown }
type Cache = { fetchedAt: number; quotes: string[] }

const format = (q: Raw) => {
  const text = typeof q.text === 'string' ? q.text.trim() : ''
  if (text === '') return undefined
  const author = typeof q.author === 'string' && q.author.trim() !== '' ? q.author.trim() : 'Unknown'
  return `"${text}" — ${author}`
}

const cached = async ($: EngineInterface) => {
  const c = (await $.store.get('cache')) as Cache | undefined
  return c !== undefined && Array.isArray(c.quotes) && c.quotes.length > 0 ? c : undefined
}

// Downloads the list when it is missing or a week old; keeps the old one if the fetch fails.
const seed = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const c = await cached($)
  if (c !== undefined && now - c.fetchedAt < REFRESH_MS) return c
  const res = await $.http.fetch(SOURCE).catch(() => undefined)
  if (res === undefined || !res.ok) return c
  try {
    const list = JSON.parse(res.text) as Raw[]
    const quotes = Array.isArray(list) ? list.map(format).filter((q): q is string => q !== undefined) : []
    if (quotes.length === 0) return c
    const fresh: Cache = { fetchedAt: now, quotes }
    await $.store.set('cache', fresh)
    return fresh
  } catch {
    return c
  }
}

const isQuestion = (answer: string) => {
  const lines = answer.split('\n').filter(l => l.trim() !== '')
  const last = (lines[lines.length - 1] ?? '').trim().replace(/(\*\*|`)+$/, '')
  return last.endsWith('?')
}

const pick = async ($: EngineInterface) => {
  const c = (await cached($)) ?? (await seed($))
  if (c === undefined) return undefined
  return c.quotes[Math.floor(Math.random() * c.quotes.length)]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    void seed($).catch(() => undefined)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && !e.isAborted && !isQuestion(e.answer)) {
      const quote = await pick($).catch(() => undefined)
      if (quote !== undefined) {
        const entry: FinishQuote = { turnId: e.turnId, durationMs: e.durationMs, quote }
        await update($, quotes, list => [...list, entry].slice(-KEEP))
      }
    }
    return result
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.props.waitingFor !== undefined) return next(e)
    const list = await read($, quotes)
    let best: FinishQuote | undefined
    for (const q of list) {
      const diff = Math.abs(q.durationMs - e.props.durationMs)
      if (diff <= MATCH_MS && (best === undefined || diff < Math.abs(best.durationMs - e.props.durationMs))) best = q
    }
    if (best === undefined) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box marginTop={1} marginBottom={1}>
          <Text dimColor>$ {best.quote}</Text>
        </Box>
      </Box>
    )
  })
}
