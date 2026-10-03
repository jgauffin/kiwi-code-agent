# Screenshots

Every image the articles reference. Save each as PNG under `articles/images/` with the name given; the articles load them from `main` on GitHub, so they show once pushed. Capture at 100% zoom in the dark theme the existing shots use, cropped to the panel that matters, at most 1600 px wide.

Use the running example throughout: the order-cancellation feature, with the finding that refunds over 500 are never paid.

| File | Used in | What to capture |
|---|---|---|
| `cover.png` | 00, 01 (cover) | Done: the logo on a 1000×420 canvas. |
| `cover-cost.png` | cto-why-this-costs-less (cover) | Generated, not captured: two cost curves over a year, the fast one bending up, the deliberate one flat and crossing it. See the note under the table. |
| `cover-decay.png` | cto-no-silent-decay (cover) | Generated, not captured: a structure half eroded, held up where it is pinned to something. See the note under the table. |
| `new-session.png` | 01 | The new-session screen with the **Feature planning** card picked and the one-line description typed. |
| `plan-direction.png` | 01, 03 | The planner's first answer in chat: the direction and its questions, before any spec is written. |
| `spec-tab.png` | 01 | The Spec tab of the draft: the rules with their citations, before approval. |
| `check-line.png` | 01 | The plan bar while the check reads the code: its one line of progress and the Stop button. The file under this name today holds the Spec tab instead, so one of the two names is wrong. |
| `decisions.png` | 00, 01, 04 | Done: the Decisions tab, one decision with its proposals, **Keep the spec**, own ruling and the recommendation. Not the refund example. |
| `tasks-tab.png` | 01, 06 | Done: the Tasks tab, tasks per scenario with their states and files. |
| `spec-coverage.png` | 00, 01, 06 | Done: the Spec tab during development, rules with their intent, task and test marks, and a struck rule carrying `no task` and `no test`. |
| `verification-bar.png` | 01, 05 | The plan bar right after a verification run: the commands that ran, per project, and the outcome. |
| `cleanup-offer.png` | 01, 05 | Done: the Cleanup tab with units over their limit and the choices. |
| `runscript-diff.png` | 02 | A RunScript review: several files changed, shown as one diff to approve or decline. Article 00 carries no image for it until this exists. |
| `profiles-list.png` | 00, 07 | Done: Settings, Profiles tab, each profile with its model per step. |
| `stale-write.png` | 00 | Done: a RunScript write blocked because another implement session had changed the file. |
| `shell-prompt.png` | 08 | The prompt for `npm run test -- refund && rm -rf coverage`: the test line passing as a project script, the `rm` asked. |

## The two generated covers

Flat vector, no photography, no text in the image beyond a word or two of axis label, and the dark background and accent blue the screenshots already use so the covers sit with them. Avoid what every AI article already has: robots, glowing brains, circuit boards, binary rain, a hand reaching out of a screen.

Each cover ships in two sizes, since the platforms crop differently: 1000×420 for dev.to, and 1200×627 for a LinkedIn link preview. Generate one master at 2000×840 and export both from it, keeping everything that carries the idea inside a centred safe area so the squarer crop loses nothing. LinkedIn's native article banner is a third shape again; check its current size there before publishing one.

- `cover-cost.png`: two curves on one axis, time running right, cost running up. One starts near zero and bends steeply upward; the other starts higher and stays nearly flat, crossing the first about a third of the way in. Label nothing but the crossing, or nothing at all. The whole argument of the piece is that shape.
- `cover-decay.png`: a wall or arch of blocks, intact on the left and crumbling toward the right, except where blocks are pinned to a line running underneath them, which stay put. The pinned line is the specs and their tests; the gap between the two halves is the point. Keep it structural and calm, not apocalyptic.
