# Mysterium IQ Pool · Withdraw MYST

Single-page app to withdraw staked MYST from the Mysterium [IQ Protocol](https://github.com/iqlabsorg/iq-smart-contracts) pool on Polygon.

## Dev

```bash
cd tools/iq-myst-withdraw
npm install
npm run dev
```

## Stakers snapshot

Stats preloads `public/data/stakers.json` so visitors less wait on the first paint. A background scan then replaces it with live chain data.

**Generate / refresh snapshots (once a day):**

```bash
npm run fetch-balances

# optional custom RPC:
RPC_URL=https://polygon-rpc.com npm run fetch-balances
```

Writes:
- `public/data/stakers.json` — sMYST holders
- `public/data/borrowers.json` — rMYST holders (active borrowers)

Then commit and push:

```bash
git add public/data/stakers.json public/data/borrowers.json
git commit -m "chore: update pool snapshots"
git push
```

## Build for GitHub Pages

```bash
npm run build
```

Deploy the `dist/` folder (includes `data/stakers.json` from `public/`). `vite.config.ts` uses `base: './'`.

## Notes

- Unstake needs enough **available** pool liquidity (`getAvailableReserve`). If rentals are still marked “used”, unstake may revert until `returnRental` frees reserve.
- One `unstake` transaction per sMYST NFT (sequential).
- Snapshot amounts are strings (wei) for JSON safety; the UI formats them as MYST.
