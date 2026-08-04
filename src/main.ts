import "./style.css";
import { ADDRESSES, POLYGON_CHAIN_ID } from "./config";
import { formatMyst, shortAddress } from "./format";
import {
  fetchAllStakers,
  fetchPoolStats,
  fetchUserStakes,
  publicProvider,
  unstakeAll,
  type AllStakersSnapshot,
  type PoolStats,
  type UserStakes,
} from "./pool";
import {
  fetchAllBorrowers,
  fetchUserRentals,
  returnOwnRentals,
  type AllBorrowersSnapshot,
  type UserRentals,
} from "./rentals";
import {
  fileToBorrowers,
  fileToSnapshot,
  isBorrowersSnapshotFile,
  isStakersSnapshotFile,
  type BorrowersSnapshotFile,
  type StakersSnapshotFile,
} from "./snapshot";
import {
  connectWallet,
  onAccountsChanged,
  onChainChanged,
  readWalletState,
  type WalletState,
} from "./wallet";

type Route = "home" | "stats";
type DataSource = "snapshot" | "live";

type AppState = {
  route: Route;
  pool: PoolStats | null;
  wallet: WalletState | null;
  stakes: UserStakes | null;
  /** Connected wallet rMYST rentals (null = not loaded). */
  rentals: UserRentals | null;
  allStakers: AllStakersSnapshot | null;
  stakersSource: DataSource | null;
  stakersUpdatedAt: string | null;
  stakersBlockNumber: number | null;
  stakersLoading: boolean;
  stakersRefreshing: boolean;
  stakersProgress: { done: number; total: number } | null;
  stakersSnapshotTried: boolean;
  allBorrowers: AllBorrowersSnapshot | null;
  borrowersSource: DataSource | null;
  borrowersUpdatedAt: string | null;
  borrowersBlockNumber: number | null;
  borrowersLoading: boolean;
  borrowersRefreshing: boolean;
  borrowersProgress: { done: number; total: number } | null;
  borrowersSnapshotTried: boolean;
  busy: boolean;
  status: { kind: "info" | "ok" | "err"; text: string } | null;
};

const state: AppState = {
  route: parseRoute(),
  pool: null,
  wallet: null,
  stakes: null,
  rentals: null,
  allStakers: null,
  stakersSource: null,
  stakersUpdatedAt: null,
  stakersBlockNumber: null,
  stakersLoading: false,
  stakersRefreshing: false,
  stakersProgress: null,
  stakersSnapshotTried: false,
  allBorrowers: null,
  borrowersSource: null,
  borrowersUpdatedAt: null,
  borrowersBlockNumber: null,
  borrowersLoading: false,
  borrowersRefreshing: false,
  borrowersProgress: null,
  borrowersSnapshotTried: false,
  busy: false,
  status: null,
};

function dataUrl(file: string): string {
  // Vite copies public/ to site root; base './' keeps GH Pages subpaths working.
  const base = import.meta.env.BASE_URL || "./";
  return `${base}data/${file}`;
}

const app = document.querySelector<HTMLDivElement>("#app")!;
const readProvider = publicProvider();

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hash === "stats" || hash.startsWith("stats/")) return "stats";
  return "home";
}

function navigate(route: Route) {
  const next = route === "stats" ? "#/stats" : "#/";
  if (window.location.hash !== next) {
    window.location.hash = next;
  } else {
    state.route = route;
    render();
  }
}

function setStatus(kind: "info" | "ok" | "err", text: string) {
  state.status = { kind, text };
  render();
}

function clearStatus() {
  state.status = null;
}

function utilizationPercent(pool: PoolStats): string {
  if (pool.reserve === 0n) return "0";
  return ((Number(pool.usedReserve) / Number(pool.reserve)) * 100).toFixed(1);
}

function shareOfPool(amount: bigint, total: bigint): string {
  if (total === 0n) return "0";
  return ((Number(amount) / Number(total)) * 100).toFixed(2);
}

function renderNav(): string {
  const homeActive = state.route === "home" ? "active" : "";
  const statsActive = state.route === "stats" ? "active" : "";
  return `
    <nav class="nav">
      <a href="#/" class="nav-link ${homeActive}" data-route="home">Withdraw</a>
      <a href="#/stats" class="nav-link ${statsActive}" data-route="stats">Stats</a>
    </nav>
  `;
}

function renderPoolCard(): string {
  const p = state.pool;
  const loading = !p;

  return `
    <section class="card">
      <h2>Pool overview</h2>
      <div class="stats-grid">
        <div class="stat highlight">
          <span class="label">Total MYST in pool</span>
          <div class="value ${loading ? "loading-pulse" : ""}">
            ${p ? formatMyst(p.reserve) : "—"}
            <span class="unit">MYST</span>
          </div>
        </div>
        <div class="stat muted-stat">
          <span class="label">Still rented</span>
          <div class="value ${loading ? "loading-pulse" : ""}">
            ${p ? formatMyst(p.usedReserve) : "—"}
            <span class="unit">MYST</span>
          </div>
        </div>
        <div class="stat">
          <span class="label">Available to withdraw</span>
          <div class="value ${loading ? "loading-pulse" : ""}">
            ${p ? formatMyst(p.availableReserve) : "—"}
            <span class="unit">MYST</span>
          </div>
        </div>
        <div class="stat">
          <span class="label">Utilization</span>
          <div class="value ${loading ? "loading-pulse" : ""}">
            ${p ? utilizationPercent(p) : "—"}
            <span class="unit">%</span>
          </div>
        </div>
      </div>
      <p class="stat-hint">
        Rented MYST is locked until someone calls <code>returnRental</code> on expired positions.
        You can only unstake up to the <b>available</b> reserve.
      </p>
    </section>
  `;
}

function renderPositionsTable(stakes: UserStakes): string {
  if (stakes.positionCount === 0) {
    return `
      <div class="empty-state">
        <strong>No stake positions</strong> on this wallet.<br />
        This address has no sMYST (StakeToken) NFTs in the Mysterium IQ pool.
      </div>
    `;
  }

  const rows = stakes.positions
    .map(
      (p) => `
      <tr>
        <td><code title="${p.tokenId.toString()}">#${p.tokenId.toString().slice(0, 8)}…</code></td>
        <td class="num">${formatMyst(p.initialStaked)}</td>
        <td class="num">${formatMyst(p.reward)}</td>
        <td class="num"><b>${formatMyst(p.currentValue)}</b></td>
      </tr>
    `,
    )
    .join("");

  return `
    <div class="positions">
      <table>
        <thead>
          <tr>
            <th>Position</th>
            <th class="num">Initially staked</th>
            <th class="num">Earned</th>
            <th class="num">Total now</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderWalletSection(): string {
  if (!state.wallet) {
    return `
      <section class="card connect-area">
        <button class="btn btn-primary" id="connectBtn" ${state.busy ? "disabled" : ""}>
          Connect Wallet
        </button>
        <p class="hint">MetaMask, Brave Wallet, or any injected EIP-1193 provider · Polygon</p>
      </section>
    `;
  }

  const { address, chainId } = state.wallet;
  const wrongNet = chainId !== POLYGON_CHAIN_ID;
  const stakes = state.stakes;
  const rentals = state.rentals;
  const loadingStakes = stakes === null;
  const showRentals = rentals !== null && rentals.positionCount > 0;

  return `
    <section class="card">
      <div class="wallet-bar">
        <div class="wallet-pill ${wrongNet ? "wrong-network" : ""}">
          <span class="dot"></span>
          <span title="${address}">${shortAddress(address)}</span>
          ${wrongNet ? "<span>· wrong network</span>" : "<span>· Polygon</span>"}
        </div>
        <button class="btn btn-ghost" id="disconnectBtn" type="button">Disconnect</button>
      </div>

      ${
        wrongNet
          ? `<div class="status visible err">Switch your wallet to Polygon (chainId 137) to continue.</div>`
          : ""
      }

      <h2 style="margin-top:18px">Your stake</h2>
      <div class="stats-grid">
        <div class="stat">
          <span class="label">Positions (sMYST)</span>
          <div class="value ${loadingStakes ? "loading-pulse" : ""}">
            ${stakes ? String(stakes.positionCount) : "—"}
          </div>
        </div>
        <div class="stat">
          <span class="label">Initially staked</span>
          <div class="value ${loadingStakes ? "loading-pulse" : ""}">
            ${stakes ? formatMyst(stakes.totalInitial) : "—"}
            <span class="unit">MYST</span>
          </div>
        </div>
        <div class="stat highlight">
          <span class="label">Earned from staking</span>
          <div class="value ${loadingStakes ? "loading-pulse" : ""}">
            ${stakes ? formatMyst(stakes.totalReward) : "—"}
            <span class="unit">MYST</span>
          </div>
        </div>
        <div class="stat">
          <span class="label">You can get back</span>
          <div class="value ${loadingStakes ? "loading-pulse" : ""}">
            ${stakes ? formatMyst(stakes.totalCurrent) : "—"}
            <span class="unit">MYST</span>
          </div>
        </div>
      </div>

      ${stakes ? renderPositionsTable(stakes) : ""}

      <div class="action-row">
        <button
          class="btn btn-success"
          id="withdrawBtn"
          ${
            state.busy ||
            wrongNet ||
            !stakes ||
            stakes.positionCount === 0
              ? "disabled"
              : ""
          }
        >
          Get your MYST back
        </button>
      </div>
      ${
        stakes && stakes.positionCount > 0
          ? `<p class="stat-hint">
              Unstakes <b>all</b> of your sMYST positions (principal + rewards) via
              <code>Enterprise.unstake</code>. Requires available pool liquidity.
            </p>`
          : ""
      }

      ${showRentals ? renderRentalsSection(rentals!, wrongNet) : ""}
    </section>
  `;
}

function renderRentalsSection(rentals: UserRentals, wrongNet: boolean): string {
  const rows = rentals.positions
    .map((p) => {
      const status = p.isActive
        ? '<span class="pill-mini active">active</span>'
        : p.canReturnPermissionless
          ? '<span class="pill-mini ok">expired</span>'
          : '<span class="pill-mini">ended</span>';
      return `
      <tr>
        <td><code title="${p.tokenId.toString()}">#${p.tokenId.toString().slice(0, 8)}…</code></td>
        <td class="num">${formatMyst(p.rentalAmount)}</td>
        <td class="num">${status}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="rentals-block">
      <h2>Your rentals</h2>
      <div class="stats-grid">
        <div class="stat muted-stat">
          <span class="label">Rented MYST</span>
          <div class="value">${formatMyst(rentals.totalRented)}<span class="unit">MYST</span></div>
        </div>
        <div class="stat">
          <span class="label">rMYST positions</span>
          <div class="value">${rentals.positionCount}</div>
        </div>
        <div class="stat">
          <span class="label">Still within term</span>
          <div class="value">${rentals.activeCount}</div>
        </div>
        <div class="stat">
          <span class="label">Can return now</span>
          <div class="value">${rentals.returnableCount}</div>
        </div>
      </div>
      <div class="positions">
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th class="num">Amount</th>
              <th class="num">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="action-row">
        <button
          class="btn btn-warn"
          id="returnRentedBtn"
          ${state.busy || wrongNet || rentals.returnableCount === 0 ? "disabled" : ""}
        >
          Return rented
        </button>
      </div>
      <p class="stat-hint">
        Calls <code>Enterprise.returnRental</code> for each of your rMYST NFTs.
        Unlocks pool liquidity (and you receive the small GC reward per position).
      </p>
    </div>
  `;
}

function renderStakersTable(snapshot: AllStakersSnapshot): string {
  if (snapshot.stakerCount === 0) {
    return `
      <div class="empty-state">
        <strong>No active stakers</strong> — sMYST totalSupply is 0.
      </div>
    `;
  }

  const rows = snapshot.stakers
    .map((s, i) => {
      const checksumAddr =
        s.address.length === 42
          ? `${s.address.slice(0, 6)}…${s.address.slice(-4)}`
          : s.address;
      return `
      <tr>
        <td class="num rank">${i + 1}</td>
        <td>
          <a
            class="addr"
            href="https://polygonscan.com/address/${s.address}"
            target="_blank"
            rel="noopener noreferrer"
            title="${s.address}"
          >${checksumAddr}</a>
        </td>
        <td class="num">${s.positionCount}</td>
        <td class="num">${formatMyst(s.totalInitial)}</td>
        <td class="num">${formatMyst(s.totalReward)}</td>
        <td class="num"><b>${formatMyst(s.totalCurrent)}</b></td>
        <td class="num">${shareOfPool(s.totalCurrent, snapshot.totalCurrent)}%</td>
      </tr>
    `;
    })
    .join("");

  return `
    <div class="stakers-table-wrap">
      <table class="stakers-table">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>Staker</th>
            <th class="num">Positions</th>
            <th class="num">Initially staked</th>
            <th class="num">Earned</th>
            <th class="num">Total now</th>
            <th class="num">Share</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function formatDataAge(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function renderDataSourcePill(): string {
  if (state.stakersRefreshing) {
    return `<span class="data-pill refreshing loading-pulse">Refreshing from chain…</span>`;
  }
  if (state.stakersSource === "live") {
    return `<span class="data-pill live">Live on-chain</span>`;
  }
  if (state.stakersSource === "snapshot") {
    return `<span class="data-pill snapshot">Preloaded snapshot</span>`;
  }
  return "";
}

function renderStatsPage(): string {
  const snap = state.allStakers;
  const blocking = state.stakersLoading && !snap;
  const progress = state.stakersProgress;

  let body: string;
  if (blocking) {
    const pct =
      progress && progress.total > 0
        ? Math.round((progress.done / progress.total) * 100)
        : null;
    body = `
      <div class="empty-state">
        <div class="loading-pulse"><strong>Scanning sMYST positions…</strong></div>
        <p style="margin:10px 0 0">
          ${
            progress
              ? `${progress.done} / ${progress.total} positions${pct !== null ? ` (${pct}%)` : ""}`
              : "No snapshot file — live enumeration…"
          }
        </p>
        <p class="stat-hint" style="margin-top:8px">
          Run <code>npm run fetch-stakers</code> and commit <code>public/data/stakers.json</code>
          so visitors see data instantly.
        </p>
      </div>
    `;
  } else if (!snap) {
    body = `
      <div class="empty-state">
        <p>No staker snapshot and live scan has not run yet.</p>
        <div class="action-row" style="max-width:280px;margin:16px auto 0">
          <button class="btn btn-primary" id="loadStakersBtn">Scan on-chain now</button>
        </div>
      </div>
    `;
  } else {
    body = `
      <div class="stats-meta">
        ${renderDataSourcePill()}
        <span class="meta-line">
          Updated <b>${formatDataAge(state.stakersUpdatedAt)}</b>
          ${
            state.stakersBlockNumber != null
              ? ` · block <b>${state.stakersBlockNumber}</b>`
              : ""
          }
        </span>
      </div>
      <div class="stats-grid">
        <div class="stat">
          <span class="label">Active stakers</span>
          <div class="value">${snap.stakerCount}</div>
        </div>
        <div class="stat">
          <span class="label">sMYST positions</span>
          <div class="value">${snap.positionCount}</div>
        </div>
        <div class="stat highlight">
          <span class="label">Total staked (principal)</span>
          <div class="value">${formatMyst(snap.totalInitial)}<span class="unit">MYST</span></div>
        </div>
        <div class="stat">
          <span class="label">Total value now</span>
          <div class="value">${formatMyst(snap.totalCurrent)}<span class="unit">MYST</span></div>
        </div>
      </div>
      <p class="stat-hint">
        Sorted by total value (principal + rewards).
        Snapshot is committed daily; this page always tries a silent on-chain refresh in the background.
      </p>
      ${renderStakersTable(snap)}
      <div class="action-row" style="margin-top:16px">
        <button
          class="btn btn-ghost"
          id="loadStakersBtn"
          ${state.stakersLoading || state.stakersRefreshing ? "disabled" : ""}
        >
          Refresh from chain
        </button>
      </div>
    `;
  }

  return `
    <section class="card">
      <h2>Active stakers</h2>
      ${body}
    </section>
    ${renderBorrowersCard()}
  `;
}

function renderBorrowersTable(snapshot: AllBorrowersSnapshot): string {
  if (snapshot.borrowerCount === 0) {
    return `
      <div class="empty-state">
        <strong>No active borrowers</strong> — rMYST totalSupply is 0 (all rentals returned).
      </div>
    `;
  }

  const rows = snapshot.borrowers
    .map((b, i) => {
      const addr =
        b.address.length === 42
          ? `${b.address.slice(0, 6)}…${b.address.slice(-4)}`
          : b.address;
      return `
      <tr>
        <td class="num rank">${i + 1}</td>
        <td>
          <a class="addr" href="https://polygonscan.com/address/${b.address}"
            target="_blank" rel="noopener noreferrer" title="${b.address}">${addr}</a>
        </td>
        <td class="num">${b.positionCount}</td>
        <td class="num"><b>${formatMyst(b.totalRented)}</b></td>
        <td class="num">${b.activeCount}</td>
        <td class="num">${b.permissionlessCount}</td>
        <td class="num">${shareOfPool(b.totalRented, snapshot.totalRented)}%</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="stakers-table-wrap">
      <table class="stakers-table">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>Borrower</th>
            <th class="num">Positions</th>
            <th class="num">Rented MYST</th>
            <th class="num">Still active</th>
            <th class="num">Permissionless</th>
            <th class="num">Share</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderBorrowersCard(): string {
  const snap = state.allBorrowers;
  const blocking = state.borrowersLoading && !snap;
  const progress = state.borrowersProgress;

  let body: string;
  if (blocking) {
    const pct =
      progress && progress.total > 0
        ? Math.round((progress.done / progress.total) * 100)
        : null;
    body = `
      <div class="empty-state">
        <div class="loading-pulse"><strong>Scanning rMYST positions…</strong></div>
        <p style="margin:10px 0 0">
          ${
            progress
              ? `${progress.done} / ${progress.total} positions${pct !== null ? ` (${pct}%)` : ""}`
              : "No snapshot — live enumeration…"
          }
        </p>
      </div>
    `;
  } else if (!snap) {
    body = `
      <div class="empty-state">
        <p>No borrowers snapshot yet.</p>
        <div class="action-row" style="max-width:280px;margin:16px auto 0">
          <button class="btn btn-primary" id="loadBorrowersBtn">Scan on-chain now</button>
        </div>
      </div>
    `;
  } else {
    const pill = state.borrowersRefreshing
      ? `<span class="data-pill refreshing loading-pulse">Refreshing from chain…</span>`
      : state.borrowersSource === "live"
        ? `<span class="data-pill live">Live on-chain</span>`
        : `<span class="data-pill snapshot">Preloaded snapshot</span>`;

    body = `
      <div class="stats-meta">
        ${pill}
        <span class="meta-line">
          Updated <b>${formatDataAge(state.borrowersUpdatedAt)}</b>
          ${
            state.borrowersBlockNumber != null
              ? ` · block <b>${state.borrowersBlockNumber}</b>`
              : ""
          }
        </span>
      </div>
      <div class="stats-grid">
        <div class="stat">
          <span class="label">Active borrowers</span>
          <div class="value">${snap.borrowerCount}</div>
        </div>
        <div class="stat">
          <span class="label">rMYST positions</span>
          <div class="value">${snap.positionCount}</div>
        </div>
        <div class="stat muted-stat">
          <span class="label">Total rented</span>
          <div class="value">${formatMyst(snap.totalRented)}<span class="unit">MYST</span></div>
        </div>
        <div class="stat">
          <span class="label">Permissionless returns</span>
          <div class="value">${snap.permissionlessCount}</div>
        </div>
      </div>
      <p class="stat-hint">
        Sorted by rented amount. Permissionless = past <code>enterpriseOnlyCollectionTime</code>
        (anyone can call <code>returnRental</code>). Daily snapshot: <code>npm run fetch-borrowers</code>.
      </p>
      ${renderBorrowersTable(snap)}
      <div class="action-row" style="margin-top:16px">
        <button
          class="btn btn-ghost"
          id="loadBorrowersBtn"
          ${state.borrowersLoading || state.borrowersRefreshing ? "disabled" : ""}
        >
          Refresh from chain
        </button>
      </div>
    `;
  }

  return `
    <section class="card">
      <h2>Active borrowers</h2>
      ${body}
    </section>
  `;
}

function renderStatus(): string {
  if (!state.status) return "";
  return `<div class="status visible ${state.status.kind}">${state.status.text}</div>`;
}

function renderHome(): string {
  return `
    ${state.wallet ? "" : renderPoolCard()}
    ${renderWalletSection()}
    ${renderStatus()}
    <p class="footer">
      ${state.wallet ? "" : "Read-only pool data loads without a wallet. "}
      Unstake is on-chain and irreversible for each position.
      Source: IQ Protocol
      <a href="https://github.com/iqlabsorg/iq-smart-contracts" target="_blank" rel="noopener noreferrer">contracts</a>.
    </p>
  `;
}

function render() {
  const wide = state.route === "stats" ? "wide" : "";
  const subtitle =
    state.route === "stats"
      ? "Stakers & borrowers — snapshot preload + live on-chain refresh"
      : "Withdraw staked MYST · return rentals · IQ Protocol pool";

  app.className = wide;
  app.innerHTML = `
    <header>
      <h1>Mysterium IQ Pool</h1>
      <p class="subtitle">${subtitle}</p>
      ${renderNav()}
    </header>

    ${state.route === "stats" ? renderStatsPage() : renderHome()}
    ${state.route === "stats" ? renderStatus() : ""}
  `;

  bindEvents();
}

function bindEvents() {
  document.getElementById("connectBtn")?.addEventListener("click", handleConnect);
  document.getElementById("disconnectBtn")?.addEventListener("click", handleDisconnect);
  document.getElementById("withdrawBtn")?.addEventListener("click", handleWithdraw);
  document.getElementById("returnRentedBtn")?.addEventListener("click", handleReturnRented);
  document.getElementById("loadStakersBtn")?.addEventListener("click", () => {
    void ensureStakersLoaded({ forceLive: true });
  });
  document.getElementById("loadBorrowersBtn")?.addEventListener("click", () => {
    void ensureBorrowersLoaded({ forceLive: true });
  });

  document.querySelectorAll<HTMLAnchorElement>("[data-route]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const route = el.dataset.route === "stats" ? "stats" : "home";
      navigate(route);
    });
  });
}

async function loadPreloadedStakers(): Promise<boolean> {
  if (state.stakersSource === "live" && state.allStakers) return true;
  if (state.stakersSnapshotTried) {
    return state.stakersSource === "snapshot" && state.allStakers !== null;
  }
  state.stakersSnapshotTried = true;

  try {
    const res = await fetch(dataUrl("stakers.json"), { cache: "no-cache" });
    if (!res.ok) return false;
    const json: unknown = await res.json();
    if (!isStakersSnapshotFile(json)) return false;
    if (!state.allStakers) applyStakersFile(json, "snapshot");
    return state.allStakers !== null;
  } catch (err) {
    console.warn("No preloaded stakers snapshot:", err);
    return false;
  }
}

async function loadPreloadedBorrowers(): Promise<boolean> {
  if (state.borrowersSource === "live" && state.allBorrowers) return true;
  if (state.borrowersSnapshotTried) {
    return state.borrowersSource === "snapshot" && state.allBorrowers !== null;
  }
  state.borrowersSnapshotTried = true;

  try {
    const res = await fetch(dataUrl("borrowers.json"), { cache: "no-cache" });
    if (!res.ok) return false;
    const json: unknown = await res.json();
    if (!isBorrowersSnapshotFile(json)) return false;
    if (!state.allBorrowers) applyBorrowersFile(json, "snapshot");
    return state.allBorrowers !== null;
  } catch (err) {
    console.warn("No preloaded borrowers snapshot:", err);
    return false;
  }
}

function applyStakersFile(file: StakersSnapshotFile, source: DataSource) {
  state.allStakers = fileToSnapshot(file);
  state.stakersSource = source;
  state.stakersUpdatedAt = file.updatedAt;
  state.stakersBlockNumber = file.blockNumber;
}

function applyLiveStakers(snap: AllStakersSnapshot, blockNumber: number | null) {
  state.allStakers = snap;
  state.stakersSource = "live";
  state.stakersUpdatedAt = new Date().toISOString();
  state.stakersBlockNumber = blockNumber;
}

function applyBorrowersFile(file: BorrowersSnapshotFile, source: DataSource) {
  state.allBorrowers = fileToBorrowers(file);
  state.borrowersSource = source;
  state.borrowersUpdatedAt = file.updatedAt;
  state.borrowersBlockNumber = file.blockNumber;
}

function applyLiveBorrowers(snap: AllBorrowersSnapshot, blockNumber: number | null) {
  state.allBorrowers = snap;
  state.borrowersSource = "live";
  state.borrowersUpdatedAt = new Date().toISOString();
  state.borrowersBlockNumber = blockNumber;
}

async function ensureStakersLoaded(opts: { forceLive?: boolean } = {}) {
  const forceLive = opts.forceLive === true;

  if (!forceLive && !state.stakersSnapshotTried) {
    const had = await loadPreloadedStakers();
    if (had) render();
  } else if (!forceLive && !state.allStakers) {
    await loadPreloadedStakers();
    if (state.allStakers) render();
  }

  if (state.stakersRefreshing || state.stakersLoading) return;
  if (state.allStakers && state.stakersSource === "live" && !forceLive) return;

  const hasData = state.allStakers !== null;
  if (hasData) {
    state.stakersRefreshing = true;
    state.stakersProgress = null;
    render();
  } else {
    state.stakersLoading = true;
    state.stakersProgress = null;
    render();
  }

  try {
    let blockNumber: number | null = null;
    try {
      blockNumber = await readProvider.getBlockNumber();
    } catch {
      /* non-fatal */
    }

    const snapshot = await fetchAllStakers(
      readProvider,
      hasData
        ? undefined
        : (done, total) => {
            state.stakersProgress = { done, total };
            render();
          },
    );
    applyLiveStakers(snapshot, blockNumber);
    state.stakersLoading = false;
    state.stakersRefreshing = false;
    state.stakersProgress = null;
    render();
  } catch (err) {
    console.error(err);
    state.stakersLoading = false;
    state.stakersRefreshing = false;
    state.stakersProgress = null;
    if (!state.allStakers) {
      setStatus("err", `Failed to enumerate stakers: ${errorMessage(err)}`);
    } else {
      setStatus(
        "err",
        `Stakers background refresh failed — showing preloaded data. ${errorMessage(err)}`,
      );
    }
  }
}

async function ensureBorrowersLoaded(opts: { forceLive?: boolean } = {}) {
  const forceLive = opts.forceLive === true;

  if (!forceLive && !state.borrowersSnapshotTried) {
    const had = await loadPreloadedBorrowers();
    if (had) render();
  } else if (!forceLive && !state.allBorrowers) {
    await loadPreloadedBorrowers();
    if (state.allBorrowers) render();
  }

  if (state.borrowersRefreshing || state.borrowersLoading) return;
  if (state.allBorrowers && state.borrowersSource === "live" && !forceLive) return;

  const hasData = state.allBorrowers !== null;
  if (hasData) {
    state.borrowersRefreshing = true;
    state.borrowersProgress = null;
    render();
  } else {
    state.borrowersLoading = true;
    state.borrowersProgress = null;
    render();
  }

  try {
    let blockNumber: number | null = null;
    try {
      blockNumber = await readProvider.getBlockNumber();
    } catch {
      /* non-fatal */
    }

    const snapshot = await fetchAllBorrowers(
      readProvider,
      hasData
        ? undefined
        : (done, total) => {
            state.borrowersProgress = { done, total };
            render();
          },
    );
    applyLiveBorrowers(snapshot, blockNumber);
    state.borrowersLoading = false;
    state.borrowersRefreshing = false;
    state.borrowersProgress = null;
    render();
  } catch (err) {
    console.error(err);
    state.borrowersLoading = false;
    state.borrowersRefreshing = false;
    state.borrowersProgress = null;
    if (!state.allBorrowers) {
      setStatus("err", `Failed to enumerate borrowers: ${errorMessage(err)}`);
    } else {
      setStatus(
        "err",
        `Borrowers background refresh failed — showing preloaded data. ${errorMessage(err)}`,
      );
    }
  }
}

function ensureStatsLoaded(opts: { forceLive?: boolean } = {}) {
  void ensureStakersLoaded(opts);
  void ensureBorrowersLoaded(opts);
}

async function refreshPool() {
  try {
    state.pool = await fetchPoolStats(readProvider);
    render();
  } catch (err) {
    console.error(err);
    setStatus("err", `Failed to load pool stats: ${errorMessage(err)}`);
  }
}

async function refreshWalletPositions() {
  if (!state.wallet || state.wallet.chainId !== POLYGON_CHAIN_ID) {
    state.stakes = null;
    state.rentals = null;
    render();
    return;
  }
  try {
    const provider = state.wallet.provider;
    const address = state.wallet.address;
    const [stakes, rentals] = await Promise.all([
      fetchUserStakes(provider, address),
      fetchUserRentals(provider, address),
    ]);
    state.stakes = stakes;
    state.rentals = rentals;
    render();
  } catch (err) {
    console.error(err);
    setStatus("err", `Failed to load wallet positions: ${errorMessage(err)}`);
  }
}

async function handleConnect() {
  state.busy = true;
  clearStatus();
  render();
  try {
    state.wallet = await connectWallet();
    state.busy = false;
    render();
    await refreshWalletPositions();
  } catch (err) {
    state.busy = false;
    setStatus("err", errorMessage(err));
  }
}

function handleDisconnect() {
  state.wallet = null;
  state.stakes = null;
  state.rentals = null;
  clearStatus();
  render();
}

async function handleWithdraw() {
  if (!state.wallet || !state.stakes || state.stakes.positionCount === 0) return;

  const tokenIds = state.stakes.positions.map((p) => p.tokenId);
  const total = state.stakes.totalCurrent;

  if (state.pool && total > state.pool.availableReserve) {
    setStatus(
      "err",
      `Not enough available liquidity. You need ${formatMyst(total)} MYST free, ` +
        `but only ${formatMyst(state.pool.availableReserve)} MYST is available. ` +
        `Wait for rentals to be returned or unstake a smaller portion later.`,
    );
    return;
  }

  state.busy = true;
  setStatus("info", `Unstaking ${tokenIds.length} position(s)… confirm in your wallet.`);

  try {
    const hashes = await unstakeAll(
      state.wallet.signer,
      tokenIds,
      (done, totalCount, tokenId) => {
        if (done < totalCount) {
          setStatus(
            "info",
            `Unstaking ${done + 1}/${totalCount} (token ${tokenId.toString().slice(0, 10)}…) — confirm if prompted.`,
          );
        }
      },
    );

    state.busy = false;
    const links = hashes
      .map(
        (h) =>
          `<a href="https://polygonscan.com/tx/${h}" target="_blank" rel="noopener noreferrer">${h.slice(0, 10)}…</a>`,
      )
      .join(", ");
    setStatus("ok", `Done. Unstaked ${tokenIds.length} position(s). Tx: ${links}`);
    state.stakersSource = state.stakersSource === "live" ? "snapshot" : state.stakersSource;
    await Promise.all([
      refreshPool(),
      refreshWalletPositions(),
      ensureStakersLoaded({ forceLive: true }),
    ]);
  } catch (err) {
    state.busy = false;
    setStatus("err", errorMessage(err));
    await refreshWalletPositions();
  }
}

async function handleReturnRented() {
  if (!state.wallet || !state.rentals || state.rentals.positionCount === 0) return;

  const tokenIds = state.rentals.positions.map((p) => p.tokenId);
  state.busy = true;
  setStatus(
    "info",
    `Returning ${tokenIds.length} rental(s)… confirm in your wallet.`,
  );

  try {
    const hashes = await returnOwnRentals(
      state.wallet.signer,
      tokenIds,
      (done, totalCount, tokenId) => {
        if (done < totalCount) {
          setStatus(
            "info",
            `Returning ${done + 1}/${totalCount} (token ${tokenId.toString().slice(0, 10)}…) — confirm if prompted.`,
          );
        }
      },
    );

    state.busy = false;
    const links = hashes
      .map(
        (h) =>
          `<a href="https://polygonscan.com/tx/${h}" target="_blank" rel="noopener noreferrer">${h.slice(0, 10)}…</a>`,
      )
      .join(", ");
    setStatus("ok", `Done. Returned ${tokenIds.length} rental(s). Tx: ${links}`);
    state.borrowersSource =
      state.borrowersSource === "live" ? "snapshot" : state.borrowersSource;
    await Promise.all([
      refreshPool(),
      refreshWalletPositions(),
      ensureBorrowersLoaded({ forceLive: true }),
    ]);
  } catch (err) {
    state.busy = false;
    setStatus("err", errorMessage(err));
    await refreshWalletPositions();
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      shortMessage?: string;
      reason?: string;
      message?: string;
      code?: string | number;
    };
    if (e.code === 4001 || e.code === "ACTION_REJECTED") {
      return "Transaction rejected in wallet.";
    }
    if (e.shortMessage) return e.shortMessage;
    if (e.reason) return e.reason;
    if (e.message) return e.message;
  }
  return String(err);
}

async function tryRestoreSession() {
  if (!window.ethereum) return;
  try {
    const accounts = (await window.ethereum.request?.({
      method: "eth_accounts",
    })) as string[] | undefined;
    if (accounts && accounts.length > 0) {
      state.wallet = await readWalletState();
      render();
      await refreshWalletPositions();
    }
  } catch {
    // ignore — user can connect manually
  }
}

function setupWalletListeners() {
  onAccountsChanged(async (accounts) => {
    if (!accounts.length) {
      handleDisconnect();
      return;
    }
    try {
      state.wallet = await readWalletState();
      state.stakes = null;
      state.rentals = null;
      render();
      await refreshWalletPositions();
    } catch (err) {
      setStatus("err", errorMessage(err));
    }
  });

  onChainChanged(() => {
    void (async () => {
      if (!state.wallet) return;
      try {
        state.wallet = await readWalletState();
        state.stakes = null;
        state.rentals = null;
        render();
        await refreshWalletPositions();
      } catch (err) {
        setStatus("err", errorMessage(err));
      }
    })();
  });
}

function setupRouting() {
  window.addEventListener("hashchange", () => {
    const next = parseRoute();
    if (next === state.route) return;
    state.route = next;
    state.status = null;
    render();
    if (next === "stats") {
      ensureStatsLoaded();
    }
  });
}

// Boot
setupRouting();
render();
void refreshPool();
void tryRestoreSession();
setupWalletListeners();

// Preload snapshots early; live refresh on stats
void (async () => {
  await Promise.all([loadPreloadedStakers(), loadPreloadedBorrowers()]);
  if (state.allStakers || state.allBorrowers) render();
  if (state.route === "stats") {
    ensureStatsLoaded();
  }
})();

setInterval(() => {
  void refreshPool();
}, 60_000);
