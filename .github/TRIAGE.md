# Triage: bug / blocked / needs-review

Every task is still an issue with a workstream label (`ws:A-chain`, `ws:B-runner`, `ws:C-app`, `ws:D-growth`, `ws:all`) and a day milestone (CLAUDE.md). These three labels sit on top of that.

| Label | Put it on | Means | Take it off when |
|---|---|---|---|
| `bug` | issue | Something is broken or doesn't match SPEC.md. Use the **Bug** template, which adds the label for you. | The fixing PR (`Closes #N`) merges. |
| `blocked` | issue or PR | Work can't move. The first comment says **what** blocks it (an issue number, a missing secret or access, a decision) and **who** can unblock it. | The blocker is gone. Comment saying what changed. |
| `needs-review` | PR | Ready for review. The owner of the folder it touches reviews it (workstream table in CLAUDE.md). Frozen interfaces (`packages/shared/*`, `packages/contracts/abi/*`, `packages/db/schema.sql`) need an announced PR. | Approved, or the reviewer asked for changes. The author re-adds it after pushing fixes. |

## Daily triage (about 10 minutes)

The day's triage owner (table below), once in the morning and once before signing off (IST):

1. **New `bug` issues:** add the workstream label, a priority (`P0` breaks the 30 s newcomer path, the demo, or anything on mainnet; `P1` should land this milestone; `P2` can wait), and the day milestone. Assign the workstream owner. Close duplicates with a link.
2. **`blocked`:** check that each one names a blocker and who can clear it. Chase whoever that is. Anything blocked for more than a day goes in the team chat.
3. **`needs-review`:** any PR waiting more than about 4 hours gets a nudge to its reviewer. `main` must always build, so a red CI check comes before review.
4. **P0 bugs:** someone is assigned and working on it today, or it goes in the team chat now.

## Triage owner per day

PROPOSED, confirm in `docs/decisions.md`. Until Sun Nov 22 night Gokul is the only one building, so he triages. After that the team rotates.

| Day (IST) | Owner |
|---|---|
| Sat Nov 21 – Sun Nov 22 | Gokul |
| Mon Nov 23 | Divesh |
| Tue Nov 24 | Dijo |
| Wed Nov 25 | Gokul |
| Thu Nov 26 | Divesh |
| Fri Nov 27 | Dijo |
| Sat Nov 28 | Gokul |
| Sun Nov 29 | Divesh |
| Mon Nov 30 – submission (04:29 IST Dec 1) | Dijo, with everyone on P0s |
