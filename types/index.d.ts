/**
 * A main-loop turn that finished, tied to that turn's duration line.
 * `quote` is absent for a turn that gets none (a question, an interrupt), so that
 * turn's line still matches its own entry instead of a neighbour's.
 * `sincePromptMs` is the time from the person's last prompt to the turn's end. The line
 * counts from there, which differs from `durationMs` when a turn was resumed by a
 * background-agent notification. Absent on entries stored by older versions.
 */
export type FinishQuote = { turnId: string; durationMs: number; quote?: string; sincePromptMs?: number }

declare module 'claude-code' {
  interface PluginState {
    'finish-quote': { quotes: FinishQuote[]; lastPromptAt: number }
  }
}
