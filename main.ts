import { runBars, BarsState } from './vendor/makefun-bars.ts';
import type { Batch, Done, OrderInput } from './vendor/makefun-bars.ts';

interface PositionState {
  entryPrice: bigint;
  entryBar: number;
  peakPrice: bigint;
  soldHalf: boolean;
  initialQty: bigint;
}

let activePos: PositionState | null = null;
let cooldownUntilBar = 0;
let tradeCount = 0;
let losingTradeCount = 0;
const closes: bigint[] = [];
let lastBuyClientId: string | null = null;
let peakEquity = 1000000000n;

await runBars({
  onHello(state: BarsState) {
    peakEquity = state.equity;
  },
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const symbol = 'CBBTC';
    const bar = state.latest.get(symbol);
    if (!bar) return [];

    const c = BigInt(bar.c);
    closes.push(c);
    const n = closes.length;

    if (state.equity > peakEquity) {
      peakEquity = state.equity;
    }

    // Check fills to update entry price or track exits
    for (const f of batch.fills) {
      if (f.status === 'filled' && f.symbol === symbol) {
        if (f.side === 'buy') {
          const fillPrice = BigInt(f.price);
          const qty = BigInt(f.qty);
          activePos = {
            entryPrice: fillPrice,
            entryBar: batch.seq,
            peakPrice: fillPrice,
            soldHalf: false,
            initialQty: qty,
          };
          tradeCount++;
        } else if (f.side === 'sell') {
          const pos = state.positions.get(symbol);
          if (!pos || pos.qty === 0n) {
            if (activePos) {
              const exitPrice = BigInt(f.price);
              if (exitPrice < activePos.entryPrice) {
                losingTradeCount++;
              }
              activePos = null;
              cooldownUntilBar = batch.seq + 45;
            }
          }
        }
      } else if (f.status === 'rejected' && f.client_id === lastBuyClientId) {
        lastBuyClientId = null;
      }
    }

    const pos = state.positions.get(symbol);
    if (pos && pos.qty > 0n && activePos) {
      if (c > activePos.peakPrice) {
        activePos.peakPrice = c;
      }
    } else if ((!pos || pos.qty === 0n) && activePos) {
      activePos = null;
      cooldownUntilBar = batch.seq + 45;
    }

    if (n < 120 || state.warmingUp) {
      return [];
    }

    // Indicators
    let high120 = 0n;
    let low120 = 10n ** 20n;
    let low60 = 10n ** 20n;
    const start120 = Math.max(0, n - 120);
    const start60 = Math.max(0, n - 60);

    for (let i = start120; i < n; i++) {
      if (closes[i]! > high120) high120 = closes[i]!;
      if (closes[i]! < low120) low120 = closes[i]!;
    }
    for (let i = start60; i < n; i++) {
      if (closes[i]! < low60) low60 = closes[i]!;
    }

    const close30 = closes[n - 30] ?? c;
    const low120Val = low120;

    const orders: OrderInput[] = [];

    // EXITS
    if (pos && pos.qty > 0n && activePos) {
      const entryPrice = activePos.entryPrice;
      const peakPrice = activePos.peakPrice;
      const barsHeld = batch.seq - activePos.entryBar;

      // Hard stop (-1.0%)
      if (c <= (entryPrice * 990n) / 1000n) {
        orders.push({
          side: 'sell',
          symbol,
          qty: pos.qty,
          max_slippage_bps: 100,
        });
        return orders;
      }

      // Time exit (>= 180 bars)
      if (barsHeld >= 180) {
        orders.push({
          side: 'sell',
          symbol,
          qty: pos.qty,
          max_slippage_bps: 100,
        });
        return orders;
      }

      // Profit ladder: sell half at +1.0% (plateau center of the 1.008-1.011
      // flat region; 1.013-1.014 is a one-fill step up, not a plateau).
      let remainingQty = pos.qty;
      if (!activePos.soldHalf && c >= (entryPrice * 1010n) / 1000n) {
        const halfQty = pos.qty / 2n;
        if (halfQty > 0n) {
          activePos.soldHalf = true;
          remainingQty = pos.qty - halfQty;
          orders.push({
            side: 'sell',
            symbol,
            qty: halfQty,
            max_slippage_bps: 100,
          });
        }
      }

      // Trailing stop on remainder: once peak >= entry * 1.008, sell if c <= peak * 0.993.
      // If the ladder just fired this bar, sell only the remainder (pos.qty is the
      // pre-fill quantity, so selling pos.qty again would over-sell the position).
      if (peakPrice >= (entryPrice * 1008n) / 1000n) {
        if (c <= (peakPrice * 993n) / 1000n) {
          if (remainingQty > 0n) {
            orders.push({
              side: 'sell',
              symbol,
              qty: remainingQty,
              max_slippage_bps: 100,
            });
          }
          return orders;
        }
      }

      return orders;
    }

    // DRAWDOWN HALT
    const drawdownHalt = state.equity < (peakEquity * 985n) / 1000n;
    if (drawdownHalt) {
      return orders;
    }

    // ENTRIES
    if ((!pos || pos.qty === 0n) && cooldownUntilBar <= batch.seq) {
      if (tradeCount >= 3 || losingTradeCount >= 2) {
        if (batch.seq >= 1200 && tradeCount === 0) {
          const shallowTrigger = (high120 * 993n) / 1000n;
          const fastLeg = (close30 * 992n) / 1000n;
          const nearLow = (low60 * 1005n) / 1000n;
          if (c <= shallowTrigger && c <= fastLeg && c <= nearLow && c > low120Val) {
            const spend = (state.cash * 40n) / 100n;
            if (spend >= 1000000n) {
              const client_id = state.clientId();
              lastBuyClientId = client_id;
              orders.push({
                side: 'buy',
                symbol,
                notional_quote_units: spend,
                max_slippage_bps: 100,
                client_id,
              });
            }
          }
        }
        return orders;
      }

      const dipTrigger = (high120 * 990n) / 1000n;
      const fastLeg = (close30 * 992n) / 1000n;
      const nearLow = (low60 * 1005n) / 1000n;

      const isDip = c <= dipTrigger;
      const isFastLeg = c <= fastLeg;
      const isNearLow = c <= nearLow;
      const notFreshCollapse = c > low120Val;

      let triggerOk = isDip && isFastLeg && isNearLow && notFreshCollapse;
      if (!triggerOk && batch.seq >= 1200 && tradeCount === 0) {
        const shallowTrigger = (high120 * 993n) / 1000n;
        if (c <= shallowTrigger && isFastLeg && isNearLow && notFreshCollapse) {
          triggerOk = true;
        }
      }

      if (triggerOk) {
        const sizePct = (batch.seq >= 1200 && tradeCount === 0) ? 40n : 60n;
        const spend = (state.cash * sizePct) / 100n;
        if (spend >= 1000000n) {
          const client_id = state.clientId();
          lastBuyClientId = client_id;
          orders.push({
            side: 'buy',
            symbol,
            notional_quote_units: spend,
            max_slippage_bps: 100,
            client_id,
          });
        }
      }
    }

    return orders;
  },
});
