# finish-quote

A Claude Code mod that shows a random motivational quote right under the turn-end line
("✻ Churned for 2m 20s") whenever Claude really finishes a turn:

```
✻ Churned for 2m 20s

$ "Creativity comes from trust." — Rita Mae Brown

```

- Shown only on real finishes: not when the reply ends with a question, when the turn was
  interrupted, for subagent turns, or while background work is still running.
- Each quote stays with its own turn when you scroll back.
- Quotes come from [dwyl/quotes](https://github.com/dwyl/quotes). The list is downloaded the
  first time the mod starts after you install it, kept in the mod's own store, and refreshed
  weekly. If it can't be downloaded (offline), no quote is shown and nothing else changes.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install finish-quote --marketplace philipborbon/claude-finish-quote
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install finish-quote --marketplace philipborbon/claude-finish-quote
```

The quote appears after your next finished turn in a new session.
