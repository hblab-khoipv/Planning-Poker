# UI refresh — before / after

Captured against the real app (Next.js + API + Postgres) at three viewports, with a four-person
room so the table, deck, host controls and results all carry real data.

- **before** = `origin/main` @ `13f33a6`
- **after** = this branch

Both sets come from the same four-person room (host + three guests who have voted), captured
against the real stack so the table, deck, emoji bar, host controls and results carry real data.

| Screen          | 1366×768                                    | 1440×900                                    | mobile 390                                    |
| --------------- | ------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| Home            | `home-1366x768-{before,after}.png`          | `home-1440x900-{before,after}.png`          | `home-mobile-390-{before,after}.png`          |
| Room — voting   | `room-voting-1366x768-{before,after}.png`   | `room-voting-1440x900-{before,after}.png`   | `room-voting-mobile-390-{before,after}.png`   |
| Room — revealed | `room-revealed-1366x768-{before,after}.png` | `room-revealed-1440x900-{before,after}.png` | `room-revealed-mobile-390-{before,after}.png` |

The "no page scroll" claim these pictures illustrate is asserted for real in
`apps/web/e2e/layout.spec.ts`, which measures `scrollHeight - clientHeight` at both desktop
viewports in both round states.
