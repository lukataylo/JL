# Expense picker UI — build instructions

Chosen direction: **Option A "Arc dial"**, with Option D's idea of showing real budget numbers in the readout.
Prototype with all four options: https://claude.ai/artifact/MMnfSiafFUffWW5wpNE3Wh
Reference: a curved month dial with tick marks, labels on the inside of the arc and icons on the outside (Image #1 in the design thread).

## What it is

Pressing **Request funds** (the `+` CTA on Home, and every other `startRequest` entry point) no longer drops straight into the Clearance chat. It first opens a full-screen **expense type picker**: a curved dial of spend categories that swings in from the left edge. The employee turns the dial to a category, sees what policy says about it, and taps **Start negotiation**. `RequestAgent` then opens with that category already set, an opening question written for that category, and matching suggestion chips.

**Not sure** skips the picker and opens the chat with no category, which is how it worked before.

## Files

| File | Change |
|---|---|
| `web/src/categories.ts` (new) | Category labels, policy hints, opening questions, suggestions, and `categoryStatus()` |
| `web/src/ExpensePicker.tsx` (new) | The dial screen |
| `web/src/expense-picker.css` (new) | Styles, prefixed `ep-` |
| `web/src/App.tsx` | `startRequest` opens the picker; the picked category is passed to `RequestAgent` |
| `web/src/RequestAgent.tsx` | New `category` prop: opening line, chips, header subtitle; sends `category` with the first message |
| `web/src/api.ts` | `requestFunds(..., category)`; `PolicyDoc.policy` gains `roles` and `prohibitedCategories` (the server already returns them) |
| `web/src/icons.tsx` | Adds a `repairs` icon |
| `server/src/index.ts` | `POST /api/requests` accepts an optional `category` |
| `server/src/funds.ts` | `talk()` takes the picked category, stores it on a new request, and shows it to the model as the employee's claim |

## Data shown (all real, nothing invented)

There are no per-category budgets in the policy, so the readout uses what exists:

- **Budget left**: `overview.budgetLeft` (monthly budget minus spent minus released-unspent).
- **Per payment**: `POLICY.roles[role].perTxnLimit` (P3).
- **Spent here this month**: sum of this employee's approved transactions in that category since the 1st.
- **Status** from policy:
  - `ok`: in the role's categories (P2).
  - `reason`: allowed but outside the role's categories, so the employee needs a reason (P2). Shown as an amber pill.
  - `blocked`: in `prohibitedCategories` (P1). Kept on the dial with a lock icon; the start button is disabled. Employees should see that something is blocked rather than wonder where it went.
- **Hint**: one line per category tied to real rules (P6 hardware pre-approval, approved vendors, P7 out-of-hours, and so on).

## Dial order and start position

1. The role's categories, in policy order.
2. Other allowed categories (status `reason`).
3. `other`.
4. Prohibited categories, last.

The dial starts on the category the employee used most this month, or the first role category if there's no history.

## Geometry (mobile-first, inside the 480px shell)

- Arc centre sits off-screen to the left: `cx = apex − R`, where `R = max(300, 0.62 × dialHeight)` and `apex = min(width − 56, 0.74 × width)`. The arc's vertical centre is the middle of the dial area.
- Three radii: icons at `R`, ticks at `R − 72`, labels at `R − 108`, right-aligned and rotated along the radius like the reference's month names.
- Item spacing is 80px along the icon arc (`dθ = 80 / R`). There are 3 ticks per item; the tick on an item is the longer major tick.
- Items fade out by `|θ| = 1.25 rad`. Icon scale is `1.22 − 0.14 × min(|i − pos|, 3)`.
- An ink notch with a wasabi halo marks the selected position, just inside the icon at `θ = 0`.
- The readout card is docked at the bottom of the screen above the safe area.

## Interaction

- **Wheel or trackpad**: moves the target by `delta / 110` items, then snaps 130ms after the last event.
- **Vertical drag**: 64px per item, snaps on release. A drag moves past a 5px threshold first, so taps still work.
- **Tap an icon**: turns the dial to it. Tapping the selected icon starts the negotiation, unless the category is blocked.
- **Keyboard**: the dial has focus on open. ↑/↓ (or ←/→) step one item, Enter starts, Escape closes.
- **Motion**: positions ease toward the target (`pos += (target − pos) × 0.2` per frame) and are written straight to element styles in `requestAnimationFrame`. React only re-renders when the selected index changes.
- **Entry**: the overlay slides up like `ra-overlay`, and the dial swings in from the left with a spring. `prefers-reduced-motion` turns both off.

## Server contract

`POST /api/requests` body: `{ employeeId, message, requestId?, category? }`.
`category` only applies when a new request is created. Unknown values are ignored. The model sees it as `category_so_far` in the case file, and the system prompt tells it to treat a picked category as the employee's claim: keep it if the story fits, correct it if it doesn't. The existing P1 guardrail still stops any release in a prohibited category, so the picker is a convenience, not a security boundary.

## Visual spec — follows `docs/dot-aura-ui.md`

The picker uses the Dot Aura theme and its primitives. It doesn't edit the files the Dot Aura builder owns (`dot-aura.css`, `DotAura.tsx`); it only imports `GlassOrb` and reads its tokens (`--wasabi`, `--font-dot`, `--surface`, `--escalated*`, `--declined`, `--ink`, `--tint-1…8`).

- **Page**: fog `--bg`. The overlay slides up like `ra-overlay`.
- **Header**: Geist title "What's it for?" (25px, 600 weight, −0.02em), a white round close button, and a white "Not sure" pill.
- **Dial**: drawn like a ruler. Minor ticks are 1.5px at `rgba(20,20,20,.28)`; major ticks are `--ink`. Labels are muted uppercase Geist (12px, 0.14em tracking); the selected label is ink. Categories are `GlassOrb`s tinted `--tint-n` with a white stroke icon. The selected orb gets a white and ink double ring. Blocked orbs are greyscale with a white lock badge and red lock icon, the same style as the declined chip.
- **Notch**: an ink dot with a wasabi halo. There is no aura gradient on the dial, because the guide keeps gradients away from text.
- **Readout**: a flat `--surface` tile with a 30px radius and no border, shadow or blur. Budget left is the only **Doto** number (40px, 900 weight). The other stats sit in white sub-tiles in Geist.
- **Chips**: "In your role" is wasabi, "Needs a reason · P2" is the escalated amber, and "Blocked · P1" is white with an `#e1e1df` ring and red text.
- **CTA**: ink pill, 52px tall. When disabled it becomes a white pill with a ring.
- **No mint** anywhere, and no `backdrop-filter`.

## Acceptance

- [ ] Request funds opens the picker, and Start negotiation opens the chat with the category's opening line and chips.
- [ ] The first `POST /api/requests` carries `category`, and the stored request has it before the model replies.
- [ ] Blocked categories show a lock and a disabled button, and can't be started by tap or Enter.
- [ ] A category outside the role shows the "Needs a reason" pill.
- [ ] Not sure opens the old open-ended chat.
- [ ] Wheel, drag, tap and keyboard all work. It works at 360px width, and there are no React re-renders per animation frame.
- [ ] `npm run build` in `web/` passes (`tsc --noEmit`), and `server` typechecks.
