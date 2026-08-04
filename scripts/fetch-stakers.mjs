#!/usr/bin/env node
/**
 * Daily (or ad-hoc) scan of Mysterium IQ pool sMYST holders.
 * Writes public/data/stakers.json for the SPA to preload.
 *
 * Usage:
 *   npm run fetch-stakers
 *   RPC_URL=https://… npm run fetch-stakers
 *
 * Commit & push the JSON so GitHub Pages serves a fresh snapshot.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "data", "stakers.json");

const CHAIN_ID = 137;
const ENTERPRISE = "0xbF9F6b1D910AA207DaA400931430ef110570F8FF";
const STAKE_TOKEN = "0x8aE66d7858578764d573FfB0ece58Db59E569bC1";
const RPC_URL =
  process.env.RPC_URL ||
  process.env.POLYGON_RPC_URL ||
  "https://polygon-bor-rpc.publicnode.com";

const ENTERPRISE_ABI = [
  "function getStake(uint256 stakeTokenId) view returns (tuple(uint256 amount, uint256 shares, uint256 block))",
  "function getStakingReward(uint256 stakeTokenId) view returns (uint256)",
];

const STAKE_TOKEN_ABI = [
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const CHUNK = 25;

function parseStake(raw) {
  const amount = raw.amount ?? raw[0];
  return BigInt(amount);
}

async function main() {
  const started = performance.now();
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Enterprise: ${ENTERPRISE}`);
  console.log(`StakeToken: ${STAKE_TOKEN}`);

  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID);
  const enterprise = new Contract(ENTERPRISE, ENTERPRISE_ABI, provider);
  const stakeToken = new Contract(STAKE_TOKEN, STAKE_TOKEN_ABI, provider);

  const blockNumber = await provider.getBlockNumber();
  const totalSupply = Number(await stakeToken.totalSupply());
  console.log(`Block ${blockNumber} · sMYST totalSupply = ${totalSupply}`);

  const byOwner = new Map();

  for (let start = 0; start < totalSupply; start += CHUNK) {
    const end = Math.min(start + CHUNK, totalSupply);
    const indices = Array.from({ length: end - start }, (_, k) => start + k);

    const tokenIds = await Promise.all(
      indices.map((i) => stakeToken.tokenByIndex(i)),
    );

    const rows = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const [owner, stakeRaw, reward] = await Promise.all([
          stakeToken.ownerOf(tokenId),
          enterprise.getStake(tokenId),
          enterprise.getStakingReward(tokenId),
        ]);
        const initialStaked = parseStake(stakeRaw);
        const rewardBn = BigInt(reward);
        return {
          owner: String(owner).toLowerCase(),
          initialStaked,
          reward: rewardBn,
          currentValue: initialStaked + rewardBn,
        };
      }),
    );

    for (const row of rows) {
      const prev = byOwner.get(row.owner) ?? {
        positionCount: 0,
        totalInitial: 0n,
        totalReward: 0n,
        totalCurrent: 0n,
      };
      prev.positionCount += 1;
      prev.totalInitial += row.initialStaked;
      prev.totalReward += row.reward;
      prev.totalCurrent += row.currentValue;
      byOwner.set(row.owner, prev);
    }

    const pct = totalSupply === 0 ? 100 : Math.round((end / totalSupply) * 100);
    process.stdout.write(`\r  scanned ${end}/${totalSupply} (${pct}%)`);
  }
  process.stdout.write("\n");

  const stakers = [...byOwner.entries()]
    .map(([address, v]) => ({
      address,
      positionCount: v.positionCount,
      totalInitial: v.totalInitial.toString(),
      totalReward: v.totalReward.toString(),
      totalCurrent: v.totalCurrent.toString(),
    }))
    .sort((a, b) => {
      const av = BigInt(a.totalCurrent);
      const bv = BigInt(b.totalCurrent);
      if (av === bv) return 0;
      return av > bv ? -1 : 1;
    });

  let totalInitial = 0n;
  let totalReward = 0n;
  let totalCurrent = 0n;
  for (const s of stakers) {
    totalInitial += BigInt(s.totalInitial);
    totalReward += BigInt(s.totalReward);
    totalCurrent += BigInt(s.totalCurrent);
  }

  const elapsedMs = Math.round(performance.now() - started);
  const payload = {
    version: 1,
    chainId: CHAIN_ID,
    enterprise: ENTERPRISE,
    stakeToken: STAKE_TOKEN,
    updatedAt: new Date().toISOString(),
    blockNumber,
    elapsedMs,
    positionCount: totalSupply,
    stakerCount: stakers.length,
    totalInitial: totalInitial.toString(),
    totalReward: totalReward.toString(),
    totalCurrent: totalCurrent.toString(),
    stakers,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote ${OUT}`);
  console.log(
    `  stakers=${payload.stakerCount} positions=${payload.positionCount} ` +
      `totalNow≈${(Number(totalCurrent) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })} MYST ` +
      `(${elapsedMs} ms)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
