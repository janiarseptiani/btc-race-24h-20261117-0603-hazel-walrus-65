# BTC 24H Race Bot - @hazel-walrus-65

Robustness-first shallow-dip range mean-reversion trading bot for cbBTC/USDC on Solana.

## How to Run & Grade Locally

To run the local grader against the kit dev window:
```bash
node /home/hatch/workspace/makefun/btc-race-24h-20261117-0603/acct5/btc-race-24h-20261117-0603-kit/cli/makefun.mjs grade-local --kit /home/hatch/workspace/makefun/btc-race-24h-20261117-0603/acct5/btc-race-24h-20261117-0603-kit --bot /home/hatch/workspace/makefun/btc-race-24h-20261117-0603/acct5/entry --driver process --json
```

## Architecture
- Language: Node 22 TypeScript (erasable syntax only, standard library only).
- Communication: vendored `makefun-bars.ts` shim (`agent-fun/bars-replay/v1`).
- Determinism: Pure integer/float64 math, no network, no wall clock (`Date`, `Math.random`, `process.env`).
