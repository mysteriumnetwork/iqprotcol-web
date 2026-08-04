#!/usr/bin/env node
/**
 * Daily (or ad-hoc) scan of Mysterium IQ pool rMYST holders (borrowers).
 * Writes public/data/borrowers.json for the SPA to preload.
 *
 * Usage:
 *   npm run fetch-borrowers
 *   RPC_URL=https://… npm run fetch-borrowers
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "data", "borrowers.json");

const CHAIN_ID = 137;
const ENTERPRISE = "0xbF9F6b1D910AA207DaA400931430ef110570F8FF";
const RENTAL_TOKEN = "0xa714cF1267F4a701B646c5CbF660C4B1aCb7A82e";
const RPC_URL =
  process.env.RPC_URL ||
  process.env.POLYGON_RPC_URL ||
  "https://polygon-bor-rpc.publicnode.com";

const ENTERPRISE_ABI = [
  "function getRentalAgreement(uint256) view returns (uint112 rentalAmount,uint16 ptIdx,uint32 startTime,uint32 endTime,uint32 renterOnlyReturnTime,uint32 enterpriseOnlyCollectionTime,uint112 gcReward,uint16 gcTokenIdx)",
];

const RENTAL_TOKEN_ABI = [
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const CHUNK = 25;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function parseAgreement(raw) {
  return {
    rentalAmount: BigInt(raw.rentalAmount ?? raw[0]),
    endTime: Number(raw.endTime ?? raw[3]),
    enterpriseOnlyCollectionTime: Number(raw.enterpriseOnlyCollectionTime ?? raw[5]),
  };
}

async function main() {
  const started = performance.now();
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Enterprise: ${ENTERPRISE}`);
  console.log(`RentalToken: ${RENTAL_TOKEN}`);

  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID);
  const enterprise = new Contract(ENTERPRISE, ENTERPRISE_ABI, provider);
  const rentalToken = new Contract(RENTAL_TOKEN, RENTAL_TOKEN_ABI, provider);

  const blockNumber = await provider.getBlockNumber();
  const totalSupply = Number(await rentalToken.totalSupply());
  const t = nowSec();
  console.log(`Block ${blockNumber} · rMYST totalSupply = ${totalSupply}`);

  const byOwner = new Map();

  for (let start = 0; start < totalSupply; start += CHUNK) {
    const end = Math.min(start + CHUNK, totalSupply);
    const indices = Array.from({ length: end - start }, (_, k) => start + k);

    const tokenIds = await Promise.all(
      indices.map((i) => rentalToken.tokenByIndex(i)),
    );

    const rows = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const [owner, raw] = await Promise.all([
          rentalToken.ownerOf(tokenId),
          enterprise.getRentalAgreement(tokenId),
        ]);
        const a = parseAgreement(raw);
        return {
          owner: String(owner).toLowerCase(),
          rentalAmount: a.rentalAmount,
          isActive: a.endTime > t,
          permissionless: a.enterpriseOnlyCollectionTime < t,
        };
      }),
    );

    for (const row of rows) {
      const prev = byOwner.get(row.owner) ?? {
        positionCount: 0,
        totalRented: 0n,
        activeCount: 0,
        permissionlessCount: 0,
        permissionlessAmount: 0n,
      };
      prev.positionCount += 1;
      prev.totalRented += row.rentalAmount;
      if (row.isActive) prev.activeCount += 1;
      if (row.permissionless) {
        prev.permissionlessCount += 1;
        prev.permissionlessAmount += row.rentalAmount;
      }
      byOwner.set(row.owner, prev);
    }

    const pct = totalSupply === 0 ? 100 : Math.round((end / totalSupply) * 100);
    process.stdout.write(`\r  scanned ${end}/${totalSupply} (${pct}%)`);
  }
  process.stdout.write("\n");

  const borrowers = [...byOwner.entries()]
    .map(([address, v]) => ({
      address,
      positionCount: v.positionCount,
      totalRented: v.totalRented.toString(),
      activeCount: v.activeCount,
      permissionlessCount: v.permissionlessCount,
      permissionlessAmount: v.permissionlessAmount.toString(),
    }))
    .sort((a, b) => {
      const av = BigInt(a.totalRented);
      const bv = BigInt(b.totalRented);
      if (av === bv) return 0;
      return av > bv ? -1 : 1;
    });

  let totalRented = 0n;
  let activeCount = 0;
  let permissionlessCount = 0;
  for (const b of borrowers) {
    totalRented += BigInt(b.totalRented);
    activeCount += b.activeCount;
    permissionlessCount += b.permissionlessCount;
  }

  const elapsedMs = Math.round(performance.now() - started);
  const payload = {
    version: 1,
    chainId: CHAIN_ID,
    enterprise: ENTERPRISE,
    rentalToken: RENTAL_TOKEN,
    updatedAt: new Date().toISOString(),
    blockNumber,
    elapsedMs,
    positionCount: totalSupply,
    borrowerCount: borrowers.length,
    totalRented: totalRented.toString(),
    activeCount,
    permissionlessCount,
    borrowers,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote ${OUT}`);
  console.log(
    `  borrowers=${payload.borrowerCount} positions=${payload.positionCount} ` +
      `rented≈${(Number(totalRented) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })} MYST ` +
      `(${elapsedMs} ms)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
