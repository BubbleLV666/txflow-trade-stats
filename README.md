# TxFlow Trade Stats

Unofficial static site (HTML + CSS + JS, no build step, no server): enter a wallet address and get its statistics from the
public TxFlow API (`POST https://api.txflow.com/info`, CORS is open). Requests go straight from the visitor's browser, so rate
limits apply per visitor IP and hosting costs nothing. Not affiliated with TxFlow.

Run locally: `python -m http.server 8765` in this folder, then open http://localhost:8765/ (or just open `index.html`).
Deep link: `index.html#0x…address`.

## What it shows (everything the public API returns for an address)
* Account: equity, PnL (equity + vault equity − net deposits), ROI, free collateral, unrealized PnL, margin ratio, raw balance, state time.
* Volume & fees: daily volume chart (last 14 days), today / 7 d / 14 d, fee tier with progress and the full tier table, referral discount.
* Risk: maintenance margin, buffer, leverage, long/short split, cross margin ratio.
* Open positions: size, entry, mark, uPnL, ROE, leverage, max leverage, margin, liquidation price, ADL quantile, realized PnL, fees and
  funding since open, current funding rate, last update.
* Markets now: live ticker for the markets of the positions, open orders and most traded markets (last/mark/oracle, open interest,
  funding rate and next funding, 24 h volume and change).
* Fill analysis: maker/taker, win rate, profit factor, per-market, per-day, per-hour, realized PnL curve, leverage / margin mode,
  opening vs closing fills, flips, closed longs vs shorts, TWAP/reduce-only fills, full fills table (action, leverage, fee, PnL).
* Orders: order flow statistics, best/worst closed orders (PnL, ROE), open orders with type, trigger, flags, TIF, leverage;
  TP/SL, trigger and TWAP orders (current and history).
* Funding (by market, with average rates), deposits / withdrawals / transfers (with chains and non-perp movements listed separately).
* Spot balances and spot fills, vault deposits (equity, cost basis, PnL, TVL, lock-up) and vault details if the address is a vault.
* Referral overview, points / week countdown, Trade Unlock, Volume Ascent, Trader Royale and new-user-bonus status.

Cards are toggled with checkboxes ("Cards ⚙"); the choice is stored in the browser.

## Period
Period bar: "All time", the weeks so far (last 10), "Current" and "Custom range…". Weeks (TxFlow points epochs) run from Monday 00:00 GMT to
Sunday 23:59 GMT. Week 1 of Season 1 (Epoch I) started on 12 Oct 2026 and ends on 18 Oct 23:59:59 GMT (end time from the API's
`getUserPointsOverview`); TxFlow takes the points snapshot when a week ends. Earlier trading is covered by All time or a custom range.
The period affects volume, fees, PnL, funding, fills and charts. Positions, risk and open orders always show the current state.

## Stats image (PNG for Discord)
"🖼 Create stats image" opens an epoch card (volume, weekday bars, fills/points panel, PnL, funding, fees, active days). Use ‹ › to switch
epochs. Display name, optional background, points and rank are typed by you (the API does not expose points or ranks per wallet); the
card never contains the wallet address or balances. The six stats at the bottom are user-selectable.

## How the data is fetched
All calls are `POST /info` with a JSON body: `clearinghouseState` (account, positions), `userFills`, `userFundings`,
`userNonFundingLedgerUpdates` (deposits, withdrawals, transfers), `frontendOpenOrders`, `historicalOrders`, `feeTierRates`, `perpMeta`,
`marketTicker`, `spotClearinghouseState`, spot `userFills`, `uservaultequities`, `vaultDetails`, `userReferralOverview`, `tpslOrders`,
`triggerOrders`, `historicalTriggerOrders`, `twapHistory`, `userTwapSliceFills`, `getUserPointsOverview`, `getTradeUnlockActivity`,
`activityInfo`, `traderRoyaleInfo`, `newUserBonusInfo`.
List endpoints return at most 300 rows, newest first, and ignore `offset`, so the app walks back in time with `endTimeMs`.
The API is not officially documented yet (docs.txflow.com lists "Platform API: Coming Soon"); these calls were taken from what the
TxFlow web app itself uses, so they may change without notice.

## Differences from the Arcus version
* No leaderboard tab, per-address rank, equity/PnL history chart, rate-limit/leverage-settings cards or subaccounts:
  the public TxFlow API has no endpoints for them (leaderboards mask addresses). Points are returned only to the signed-in owner.
* Volume for today / 7 d / 14 d comes from daily volumes (`feeTierRates`, last 14 days only); longer ranges are computed from fills.
* Fee tier is estimated from the 14-day volume (TxFlow docs: rolling 14 days, assessed at the end of each UTC day).
* Perpetuals only; spot balances, vaults and prediction markets are not included.

## Limitations
* Fill analysis covers the last N fills (default 3,000) or the whole selected period.
* Net deposits count deposits, withdrawals and transfers into/out of the perps account; "PnL by account" therefore also includes
  funding, fee credits and any other exchange credits.
