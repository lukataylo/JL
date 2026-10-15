# Dot Aura UI — build instructions

Chosen direction: **Option B "Dot Aura"** from https://claude.ai/artifact/BytuJyDunT9ev1qCqkY7mL
References: Nothing OS dot-matrix type (NDot) + soft blurred "aura" gradient hero, ruler scale, white squircle tiles, chartreuse chips, glossy orbs.

## Ownership (two agents work in parallel — don't cross lines)

| Area | Owner |
|---|---|
| `web/src/dot-aura.css` (new theme layer, imported last) | Dot Aura builder |
| `web/src/DotAura.tsx` (new: `Aura`, `DotNumber`, `BudgetRuler`, `GlassOrb`) | Dot Aura builder |
| `web/src/main.tsx` (adds `import "./dot-aura.css"` after styles.css) | Dot Aura builder |
| `web/index.html` (adds Doto + Geist Google Fonts) | Dot Aura builder |
| `App.tsx`, `components.tsx`, `RequestAgent.tsx`, `AgentOrb.tsx`, `tokens.css`, `styles.css`, `request-agent.css`, `negotiation.css`, all `server/` | Primary agent |

The theme layer restyles existing class names, so the app re-skins with no markup changes. The primary agent then swaps a few pieces of markup (below) to unlock the full look.

## Visual spec

**Palette (light only)**
- Page `--bg` fog `#ECECEA`; tiles `#F8F8F7`; hairlines `rgba(0,0,0,.06)`
- Ink `#141414` (text, floating tab bar, primary buttons); secondary text `#8F8F8C`
- Aura stops by state:
  - idle / empty card: cool `#DFE4EA` base, faint lilac `#E9D8F0`
  - funded / approved: orange `#F2701F` → amber `#F6B24A` → blush `#E9AABE` (the reference)
  - thinking: amber `#F6B24A` → lilac `#B9A8FF`, slow drift
  - declined: `#E8443F` → `#F59A8A`
- Chip "Wasabi" `#E4F25A` = cleared/approved. Declined chip = white with `#E1E1DF` ring + red text `#D9433F`. Escalated chip = `#FFE2B8`.

**Type**
- Numbers that matter (available balance, released amount, outcome amount) → **Doto** 900 (dot matrix, stand-in for NDot), white on aura.
- Everything else → **Geist** 400/500/600 (stand-in for NType 82). Headings 25–28px, -0.02em. Never Doto for text longer than a number.

**Shapes**
- Aura hero: 36px radius card, edge-to-edge minus 8px, ~320px tall, gradient blurred 22px, drifts slowly (respect reduced motion).
- Tiles / list rows: 28–30px radius, no borders, no shadows (flat on fog).
- Floating tab bar: black pill, 6px padding, active tab = white pill with black text. Sits 18px above safe-area bottom.
- Buttons: pill, ink background; secondary = white pill.
- Merchant avatars → small glossy orbs (radial gradient, white specular at 35%/30%), tinted by the existing `--tint-*` hash.

**Signature details**
- `BudgetRuler`: tick ruler (1.5px white ticks every 9px, masked fade at both ends) across the bottom of the aura; tall white marker = month spent / budget; labels "£0" and "£1,265 of £2,000 this month".
- 4-dot pager under the hero (purely decorative now; later swipe between card / budget / funds).
- The aura IS the agent: during a request, the hero aura goes to `thinking`, then `approved`/`declined`. Keep `AgentOrb` (canvas) inside the request overlay, but recolour its palettes to the aura stops above.

## Primary agent: integration steps (builder files have landed)

Already live with zero markup changes: `dot-aura.css` is imported last in `main.tsx`; Doto + Geist load from `index.html`. `.hero` already renders as the aura card (`.hero-funded` = orange/amber, `.hero-empty` = cool, ink text), `.seg` renders as a white tick ruler with a tall marker, `.mono` avatars get an orb sheen, `.bg-bloom` and the welcome letterform are hidden, and while `.ra-overlay` is open the home hero switches to the thinking gradient via `body:has(.ra-overlay)`.

API (`web/src/DotAura.tsx`, all money in pence):
- `Aura({ state: "idle" | "funded" | "thinking" | "approved" | "declined", children?, className? })`
- `DotNumber({ value, currency?: string /* default "£" */, className? })` — count-up, reduced-motion aware, screen-reader text is the final formatted value.
- `BudgetRuler({ budget, spent, released, className? })` — `role="img"` with aria-label; labels "£0" and "£X of £Y this month".
- `GlassOrb({ tint /* 1..8 */, size? /* 44 */, label, children?, className? })` — `role="img"`, `aria-label={label}`; children render on top (e.g. the `.mono-badge`).
- `DotPager({ count? /* 4 */, active? /* 0 */ })` — decorative, aria-hidden.

1. Home hero (`App.tsx` ~L173). Exact swap:
   ```tsx
   import { Aura, DotNumber, BudgetRuler, DotPager } from "./DotAura";
   ...
   <Aura state={requestOpen ? "thinking" : funded ? "funded" : "idle"}>
     <div className="hero-label">
       {funded ? <span className="hero-live" /> : <Icon name="lock" size={13} strokeWidth={2.2} />}
       Available on card
     </div>
     <DotNumber value={available} />
     <BudgetRuler budget={employee.monthly_budget} spent={monthSpent} released={available} />
   </Aura>
   <DotPager />
   ```
   (`requestOpen` = whatever flag mounts `RequestAgent`. Optional: CSS already flips any idle/funded aura to the thinking gradient while `.ra-overlay` is in the DOM, so `state={funded ? "funded" : "idle"}` also works.) Drop `.hero-stats` (ruler label covers spent/budget) or move them below as plain `.glass` tiles. Remove `<section className="hero ...">` (or keep it inside `<Aura>`: a `.hero` nested in `.da-aura` is reset to plain content). Text colour on `idle` is ink; other states are white.
2. `MerchantAvatar` (`components.tsx`): 
   ```tsx
   <GlassOrb tint={tint} size={size} label={merchant}>
     <span className={`mono-badge ${status ? `mono-${status}` : ""}`}>...</span>
   </GlassOrb>
   ```
   (letters dropped visually; `label` carries the merchant name for screen readers.) `.detail-head .mono` margin: add `className="mono"` too if you want to keep that spacing rule, or style `.detail-head .da-orb`.
3. Status pills: `pill-approved/declined/escalated`, `outcome-*`, `st-*` are restyled automatically; no change needed.
4. `AgentOrb.tsx` PALETTES: approved = `#F2701F`/`#F6B24A`/`#E9AABE`; thinking = `#F6B24A`/`#B9A8FF`; declined = `#E8443F`/`#F59A8A`; idle = `#DFE4EA`/`#E9D8F0` (+ a touch of amber so it reads on the ink CTA).
5. Remove `.bg-bloom` and `GlassLetterform` on Welcome when convenient (theme hides them; `.welcome-art` now paints an aura block on its own).
6. Optional: request outcome amount → `<DotNumber value={...} className="ra-outcome-amount" />` (already Doto via CSS).
7. `npx tsc --noEmit` in `web/` must pass (it does as of the builder hand-off).

## Don'ts
- No mint green anywhere except the semantic `--approved` text colour inside chips if needed.
- No backdrop-filter glass on tiles (that was the old look).
- Don't put the gradient behind body text — only behind the big dot number and ruler.
