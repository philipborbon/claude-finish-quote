import { expect, test } from 'claude-code/testing'

const QUOTES = JSON.stringify([{ text: ' Keep going. ', author: 'Someone' }])

const LINE = (durationMs: number) => ({
  plugin: 'finish-quote',
  component: 'TurnDuration',
  surface: 'terminal',
  props: { word: 'Churned', durationMs },
}) as const

// Stands for the engine: the network serves dwyl's list, the store is kept in memory.
const engine = (on: any, opts: { online?: boolean; clock?: { now: number } } = {}) => {
  const store = new Map<string, unknown>()
  const fetches: string[] = []
  on('clock.now', () => ({ value: opts.clock?.now ?? 1_000_000 }))
  on('http.fetch', (_: unknown, e: any) => {
    fetches.push(e.url)
    return { value: opts.online === false
      ? { status: 503, ok: false, headers: {}, text: '' }
      : { status: 200, ok: true, headers: {}, text: QUOTES } }
  })
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Churned for 2m 20s</Text>
  })
  return { store, fetches }
}

const turn = (answer: string, extra: object = {}) => ({
  answer, durationMs: 140_000, isAborted: false, turnId: 't1', reason: 'answer', ...extra,
}) as any

test('a finished turn gets a quote line under the Churned line', async ($, on) => {
  engine(on)
  await $.turn.complete(turn('All done.'))
  const ui = await $.ui.mount(LINE(140_200) as any)
  expect((await ui.find({ type: 'Text', text: /Churned/ }))?.text).toBe('Churned for 2m 20s')
  expect((await ui.find({ type: 'Text', text: /Keep going/ }))?.text).toBe('$ "Keep going." — Someone')
  await ui.unmount()
})

test('a turn ending in a question gets no quote', async ($, on) => {
  engine(on)
  await $.turn.complete(turn('Done.\n\nShall I continue?'))
  const ui = await $.ui.mount(LINE(140_000) as any)
  expect(await ui.find({ type: 'Text', text: /Keep going/ })).toBe(undefined)
  await ui.unmount()
})

test('a subagent turn gets no quote', async ($, on) => {
  engine(on)
  await $.turn.complete(turn('Report.', { agentId: 'a1' }))
  const ui = await $.ui.mount(LINE(140_000) as any)
  expect(await ui.find({ type: 'Text', text: /Keep going/ })).toBe(undefined)
  await ui.unmount()
})

test('setup seeds the list from dwyl once, and later sessions reuse it', async ($, on) => {
  const { store, fetches } = engine(on)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as any)
  await $.turn.complete(turn('All done.'))
  expect((store.get('cache') as any)?.quotes).toEqual(['"Keep going." — Someone'])
  expect(fetches.length).toBe(1)
})

test('offline with nothing seeded: no quote, the Churned line is untouched', async ($, on) => {
  engine(on, { online: false })
  await $.turn.complete(turn('All done.'))
  const ui = await $.ui.mount(LINE(140_000) as any)
  expect((await ui.find({ type: 'Text', text: /Churned/ }))?.text).toBe('Churned for 2m 20s')
  expect(await ui.find({ type: 'Text', text: /Keep going/ })).toBe(undefined)
  await ui.unmount()
})

test('a turn resumed by a background-agent notification gets a quote under its longer line', async ($, on) => {
  const clock = { now: 1_000_000 }
  engine(on, { clock })
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await $.prompt.submit({ text: 'Build it.' } as any)
  clock.now += 20_000
  await $.turn.complete(turn('Waiting for the scan to finish.', { turnId: 't1', durationMs: 20_000 }))
  clock.now += 1_321_000
  await $.turn.complete(turn('All done.', { turnId: 't2', durationMs: 1_249_000 }))

  const ui = await $.ui.mount(LINE(1_341_198) as any)
  expect((await ui.find({ type: 'Text', text: /Keep going/ }))?.text).toBe('$ "Keep going." — Someone')
  await ui.unmount()
})

test('a line counted from the prompt does not take a quote from a turn that asked a question', async ($, on) => {
  const clock = { now: 1_000_000 }
  engine(on, { clock })
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await $.prompt.submit({ text: 'Plan it.' } as any)
  clock.now += 60_000
  await $.turn.complete(turn('Which option?', { turnId: 't1', durationMs: 60_000 }))

  const ui = await $.ui.mount(LINE(60_000) as any)
  expect(await ui.find({ type: 'Text', text: /Keep going/ })).toBe(undefined)
  await ui.unmount()
})
