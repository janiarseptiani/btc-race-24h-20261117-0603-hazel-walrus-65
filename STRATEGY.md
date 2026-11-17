# Strategy Document: Shallow-Dip Range Mean-Reversion (`@hazel-walrus-65`)

## Overview & Philosophy
This bot implements a **robustness-first shallow-dip range mean-reversion strategy** tailored specifically for the flat/range market structure of the 24-hour target window (which exhibits a max drawdown of only -2.12% and flat/ranging behavior). Unlike momentum bots or deep-washout strategies (which fail to trigger in shallow ranges or bleed fees in sideways chop), this bot selectively enters on confirmed minor pullbacks with strict risk guards, staged exits, and a strict trade budget.

## Core Rules & Parameters
- **Universe & Indicator Basis:** 1-minute close prices of cbBTC/USDC (price_scale 5). Rolling 120-bar high, rolling 60-bar low, 30-bar previous close. Warm-up period: first 120 bars.
- **Entry Conditions (All must be true):**
  1. Shallow dip: `close <= 0.990 * rolling-120-bar high` (at least 1.0% below 2h high).
  2. Fast leg: `close <= 0.992 * close 30 bars ago` (at least 0.8% drop over 30 minutes).
  3. Near low: `close <= 1.005 * rolling-60-bar low`.
  4. Not a fresh collapse: `close > rolling-120-bar low` (avoids catching falling knives).
  5. Drawdown halt: no new entries while `equity < 0.985 * peak equity`.
  6. Sizing: 60% of cash (conservative size to minimize impact and fee drag).
  7. Cooldown: 45 bars after any exit.
  8. Trade budget: at most 3 round trips per window; halts after 2 losing round trips.
- **Exit Conditions:**
  1. Profit ladder: sell 50% of position when `close >= entry_price * 1.010` (+1.0%).
  2. Trailing stop: once peak price since entry reaches `entry_price * 1.008`, sell remaining if `close <= peak_price * 0.993` (0.7% trail).
  3. Hard stop: sell all if `close <= entry_price * 0.990` (-1.0%).
  4. Time exit: sell all if holding `>= 180 bars`.
- **Late-Window Fallback:** After bar 1200, if 0 trades have occurred, trigger threshold relaxes slightly (`close <= 0.993 * 120-bar high`) with 40% size to guarantee the >= 1 trade guardrail.

## Robustness Validation Table (Out-of-Sample Testing)

| Window / Dataset | Market Regime / Description | Net PnL (USD) | Trades | Max Drawdown | Compliant / Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Target Dev Window** (`20261117-0603`) | Flat / Range (+0.49%, maxDD -2.12%) | **+$6.92** (+6,924,982) | 3 | 0.40% | PASS (Net PnL > $0, DD <= 2%) |
| **Past Window 1** (`20261115-0828`) | Falling (-4.00%, maxDD -7.92%) | **-$10.40** (-10,401,930) | 7 | 1.05% | PASS (PnL >= -$15, DD <= 5%) |
| **Past Window 2** (`20261113-2314`) | Falling (-4.91%, maxDD -4.97%) | **-$14.20** (-14,195,930) | 6 | 1.42% | PASS (PnL >= -$15, DD <= 5%) |

*Note: Action logs across duplicate runs matched byte-for-byte (determinism verified).*

## Parameter Sensitivity Analysis & Plateau Selection

All grid points below were re-measured independently with
`grade-local --worktree` on the target dev window. (Method note: `grade-local`
grades git HEAD by default, NOT the working tree — uncommitted parameter edits
are silently ignored. The first-draft grid numbers were re-run with
`--worktree` and corrected here; the draft's varying dip/ladder figures did not
reproduce.)

| Parameter varied | Values tested (net PnL, trades, max DD) |
| :--- | :--- |
| Dip trigger | `0.988`: **+$7.16**, 3, 0.40% \| **`0.990`: +$6.92**, 3, 0.40% (chosen) \| `0.992`: **+$6.92**, 3, 0.40% |
| Profit ladder | `1.008`: +$6.92, 3, 0.40% \| `1.009`: +$6.92, 3, 0.40% \| **`1.010`: +$6.92**, 3, 0.40% (chosen, plateau center) \| `1.011`: +$6.92, 3, 0.40% \| `1.013`: +$8.16, 3, 0.40% \| `1.014`: +$8.16, 3, 0.40% |
| Trailing stop | `0.995` (0.5% trail): +$12.11, 6, 0.41% \| **`0.993` (0.7% trail): +$6.92**, 3, 0.40% (chosen, center) \| `0.991` (0.9% trail): +$6.67, 3, 0.40% |

- **Dip 0.990:** center of a flat ±0.2pp band — all three points positive and within $0.24 of each other.
- **Ladder 1.010:** the 1.008–1.011 points produce byte-identical action logs (same sha), i.e. one flat region; 1.010 is its center. The 1.013–1.014 step (+$8.16) is a single-fill timing step at the edge of the tested range, not a plateau — deliberately NOT chased.
- **Trailing 0.993 (0.7%):** center of the tested range; both neighbours positive with max DD ≈ 0.40%. The 0.5% point (+$12.11) doubles the trade count to 6 (a second round trip unlocks) — a trade-count step at the range edge, not a plateau center, and it burns twice the fee/budget. An OOS check of the 0.5% trail (-$10.40 / -$13.60) shows it is not catastrophic out-of-sample, but the center choice stands on robustness grounds: fewer round trips, less fee bleed, mid-range PnL on every window.

## Comparison Against Baselines and Previous Washout Bot
- **Vs. Baselines (Buy-and-Hold, Momentum, EMA-Cross, RSI-Bollinger):** Buy-and-hold captures market drift but suffers in sideways ranges; momentum chasing incurs severe fee drag; EMA-cross generates frequent whipsaws. Our selective mean-reversion bot trades only on high-confidence structural dips with staged exits, avoiding unnecessary friction.
- **Vs. Previous Deep-Washout Bot:** The previous round's bot waited for extreme -4% washouts. On the current flat/range window (-2.12% max DD), a -4% trigger never fires (0 trades, failing the guardrail). This shallow-dip bot correctly adapts to the regime while maintaining strict defensive guards.
