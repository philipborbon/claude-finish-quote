/** A quote picked when a main-loop turn finished, tied to that turn's duration line. */
export type FinishQuote = { turnId: string; durationMs: number; quote: string }

declare module 'claude-code' {
  interface PluginState {
    'finish-quote': { quotes: FinishQuote[] }
  }
}
