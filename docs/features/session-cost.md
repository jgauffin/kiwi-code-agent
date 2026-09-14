# Session cost

Token and cost totals per session, not only per turn.

- The tab tooltip and the Sessions view description show the session's total cost so far and total tokens (input, cached, output).
- Totals are summed from `turn_done` events in the run log, so they survive reloads and cover every engine.
- The composer shows the running total of the active session; the per-turn line in the transcript stays.
- Pricing for models the Claude engine's own table does not know (Opus 5, Sonnet 5 through CLI 2.1.112) comes from a `kiwiAgent.pricing` setting (model id → input, cached, output USD per million); Berget prices go there too. Without an entry the cost shows as "n/a", never as 0.

Not included: budgets that stop a session, cost across sessions, org reporting.
