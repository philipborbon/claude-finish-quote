import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FinishQuote } from '../types'

// The quote list, downloaded from dwyl/quotes when the mod first starts (setup) and
// refreshed weekly, kept in the mod's own store between sessions.
const SOURCE = 'https://raw.githubusercontent.com/dwyl/quotes/main/quotes.json'
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000
// Quotes kept for scrolling back; older turns lose theirs.
const KEEP = 200
// How far the line's duration may differ from turn.complete's and still surely be the same turn.
const MATCH_MS = 1500

// The line counts from the person's last prompt, while turn.complete counts from the turn's
// own start. They differ when a background-agent notification resumed the turn, so a line
// also matches the time since the last prompt.

const quotes = atom({ plugin: 'finish-quote', key: 'quotes' } as const, [] as FinishQuote[])
const lastPromptAt = atom({ plugin: 'finish-quote', key: 'lastPromptAt' } as const, 0)

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

// The entry a duration line belongs to: the closest of its turn's duration or the time
// since the prompt, within MATCH_MS.
const match = (list: readonly FinishQuote[], lineMs: number) => {
  let best: FinishQuote | undefined
  let bestDiff = Infinity
  for (const q of list) {
    for (const ms of [q.durationMs, q.sincePromptMs]) {
      if (ms === undefined) continue
      const diff = Math.abs(ms - lineMs)
      if (diff <= MATCH_MS && diff < bestDiff) {
        best = q
        bestDiff = diff
      }
    }
  }
  return best
}

// Flattens a drawn line to its text.
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node !== null && typeof node === 'object' && 'children' in node) {
    return textOf((node as { children?: unknown }).children ?? [])
  }
  return ''
}

// How Claude Code reports a finished turn: "{PastTenseVerb} for {duration}", optionally
// "· done {clock time}" after it, e.g. "Baked for 11m 55s · done 5:37 AM" or
// "Churned for 2m 20s". "Waiting for …" lines are not finishes.
const DONE_LINE = /^[^\p{L}]*\p{L}+ for (?:\d+d\s*)?(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+(?:\.\d+)?s|\d+[hm])\b(?:.*·\s*done\b.*)?/iu
const isDoneLine = (text: string) => {
  const line = text.trim()
  return !/^[^\p{L}]*waiting\b/iu.test(line) && DONE_LINE.test(line)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    void seed($).catch(() => undefined)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (e.isMeta !== true) {
      const now = await $.clock.now()
      await update($, lastPromptAt, () => now)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const getsQuote = !e.isAborted && !isQuestion(e.answer)
    const quote = getsQuote ? await pick($).catch(() => undefined) : undefined
    const now = await $.clock.now()
    const promptAt = await read($, lastPromptAt)
    const entry: FinishQuote = {
      turnId: e.turnId,
      durationMs: e.durationMs,
      ...(quote !== undefined ? { quote } : {}),
      ...(promptAt > 0 && now >= promptAt ? { sincePromptMs: now - promptAt } : {}),
    }
    await update($, quotes, list => [...list, entry].slice(-KEEP))
    return result
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.props.waitingFor !== undefined) return next(e)
    const original = await next(e)
    const best = match(await read($, quotes), e.props.durationMs)
    let quote: string | undefined
    if (best !== undefined) {
      // A recorded turn decides: no quote when it asked a question or was interrupted.
      quote = best.quote
    } else if (isDoneLine(textOf(original))) {
      // A true-done line no recorded turn matched: a quote fixed by the line's duration, so
      // scrolling back shows the same one.
      const c = await cached($)
      quote = c === undefined ? undefined : c.quotes[Math.floor(e.props.durationMs) % c.quotes.length]
    }
    if (quote === undefined) return original

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {original}
        <Box marginTop={1} marginBottom={1}>
          <Text dimColor>$ {quote}</Text>
        </Box>
      </Box>
    )
  })
}
