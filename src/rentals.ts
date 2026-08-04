import {
  Contract,
  Interface,
  type Provider,
  type Signer,
} from "ethers";
import { ENTERPRISE_ABI, MULTICALL3_ABI, RENTAL_TOKEN_ABI } from "./abis";
import { ADDRESSES } from "./config";

export type RentalPosition = {
  tokenId: bigint;
  rentalAmount: bigint;
  startTime: number;
  endTime: number;
  renterOnlyReturnTime: number;
  enterpriseOnlyCollectionTime: number;
  /** endTime still in the future */
  isActive: boolean;
  /** Caller may return: owner always, or anyone after enterpriseOnlyCollectionTime */
  canReturnAsOwner: boolean;
  canReturnPermissionless: boolean;
};

export type UserRentals = {
  positions: RentalPosition[];
  positionCount: number;
  totalRented: bigint;
  activeCount: number;
  /** Positions the connected renter can return right now (always if owner). */
  returnableCount: number;
  returnableAmount: bigint;
};

export type BorrowerRow = {
  address: string;
  positionCount: number;
  totalRented: bigint;
  activeCount: number;
  permissionlessCount: number;
  permissionlessAmount: bigint;
};

export type AllBorrowersSnapshot = {
  borrowers: BorrowerRow[];
  positionCount: number;
  borrowerCount: number;
  totalRented: bigint;
  activeCount: number;
  permissionlessCount: number;
  elapsedMs: number;
};

const ENUM_CHUNK = 25;

function enterpriseContract(runner: Provider | Signer): Contract {
  return new Contract(ADDRESSES.enterprise, ENTERPRISE_ABI, runner);
}

function rentalTokenContract(runner: Provider | Signer): Contract {
  return new Contract(ADDRESSES.rentalToken, RENTAL_TOKEN_ABI, runner);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseAgreement(raw: {
  rentalAmount?: bigint;
  endTime?: number | bigint;
  startTime?: number | bigint;
  renterOnlyReturnTime?: number | bigint;
  enterpriseOnlyCollectionTime?: number | bigint;
  0?: bigint;
  2?: number | bigint;
  3?: number | bigint;
  4?: number | bigint;
  5?: number | bigint;
}): {
  rentalAmount: bigint;
  startTime: number;
  endTime: number;
  renterOnlyReturnTime: number;
  enterpriseOnlyCollectionTime: number;
} {
  return {
    rentalAmount: BigInt(raw.rentalAmount ?? raw[0] ?? 0n),
    startTime: Number(raw.startTime ?? raw[2] ?? 0),
    endTime: Number(raw.endTime ?? raw[3] ?? 0),
    renterOnlyReturnTime: Number(raw.renterOnlyReturnTime ?? raw[4] ?? 0),
    enterpriseOnlyCollectionTime: Number(
      raw.enterpriseOnlyCollectionTime ?? raw[5] ?? 0,
    ),
  };
}

function toPosition(
  tokenId: bigint,
  agreement: ReturnType<typeof parseAgreement>,
  t: number,
): RentalPosition {
  return {
    tokenId,
    rentalAmount: agreement.rentalAmount,
    startTime: agreement.startTime,
    endTime: agreement.endTime,
    renterOnlyReturnTime: agreement.renterOnlyReturnTime,
    enterpriseOnlyCollectionTime: agreement.enterpriseOnlyCollectionTime,
    isActive: agreement.endTime > t,
    canReturnAsOwner: true, // renter can always call returnRental
    canReturnPermissionless: agreement.enterpriseOnlyCollectionTime < t,
  };
}

/** rMYST holdings + agreements for one address. */
export async function fetchUserRentals(
  provider: Provider,
  owner: string,
): Promise<UserRentals> {
  const rentalToken = rentalTokenContract(provider);
  const enterprise = enterpriseContract(provider);
  const t = nowSec();

  const balance = Number((await rentalToken.balanceOf(owner)) as bigint);
  const positions: RentalPosition[] = [];

  for (let i = 0; i < balance; i++) {
    const tokenId = (await rentalToken.tokenOfOwnerByIndex(owner, i)) as bigint;
    const raw = await enterprise.getRentalAgreement(tokenId);
    positions.push(toPosition(tokenId, parseAgreement(raw), t));
  }

  let totalRented = 0n;
  let activeCount = 0;
  let returnableCount = 0;
  let returnableAmount = 0n;
  for (const p of positions) {
    totalRented += p.rentalAmount;
    if (p.isActive) activeCount += 1;
    // Owner path: can return any of their positions
    returnableCount += 1;
    returnableAmount += p.rentalAmount;
  }

  return {
    positions,
    positionCount: positions.length,
    totalRented,
    activeCount,
    returnableCount,
    returnableAmount,
  };
}

/**
 * Enumerate every live rMYST and aggregate by owner.
 */
export async function fetchAllBorrowers(
  provider: Provider,
  onProgress?: (done: number, total: number) => void,
): Promise<AllBorrowersSnapshot> {
  const started = performance.now();
  const rentalToken = rentalTokenContract(provider);
  const enterprise = enterpriseContract(provider);
  const t = nowSec();

  const totalSupply = Number((await rentalToken.totalSupply()) as bigint);
  const byOwner = new Map<
    string,
    {
      positionCount: number;
      totalRented: bigint;
      activeCount: number;
      permissionlessCount: number;
      permissionlessAmount: bigint;
    }
  >();

  for (let start = 0; start < totalSupply; start += ENUM_CHUNK) {
    const end = Math.min(start + ENUM_CHUNK, totalSupply);
    const indices = Array.from({ length: end - start }, (_, k) => start + k);

    const tokenIds = await Promise.all(
      indices.map((i) => rentalToken.tokenByIndex(i) as Promise<bigint>),
    );

    const rows = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const [owner, raw] = await Promise.all([
          rentalToken.ownerOf(tokenId) as Promise<string>,
          enterprise.getRentalAgreement(tokenId),
        ]);
        const a = parseAgreement(raw);
        return {
          owner: owner.toLowerCase(),
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

    onProgress?.(end, totalSupply);
  }

  const borrowers: BorrowerRow[] = [...byOwner.entries()]
    .map(([address, v]) => ({ address, ...v }))
    .sort((a, b) => {
      if (a.totalRented === b.totalRented) return 0;
      return a.totalRented > b.totalRented ? -1 : 1;
    });

  let totalRented = 0n;
  let activeCount = 0;
  let permissionlessCount = 0;
  for (const b of borrowers) {
    totalRented += b.totalRented;
    activeCount += b.activeCount;
    permissionlessCount += b.permissionlessCount;
  }

  return {
    borrowers,
    positionCount: totalSupply,
    borrowerCount: borrowers.length,
    totalRented,
    activeCount,
    permissionlessCount,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/**
 * Return rentals owned by the signer (sequential — GC reward goes to caller).
 */
export async function returnOwnRentals(
  signer: Signer,
  tokenIds: bigint[],
  onProgress?: (done: number, total: number, tokenId: bigint) => void,
): Promise<string[]> {
  const enterprise = enterpriseContract(signer);
  const hashes: string[] = [];

  for (let i = 0; i < tokenIds.length; i++) {
    const tokenId = tokenIds[i]!;
    onProgress?.(i, tokenIds.length, tokenId);
    const tx = await enterprise.returnRental(tokenId);
    const receipt = await tx.wait();
    hashes.push(receipt?.hash ?? tx.hash);
  }

  onProgress?.(tokenIds.length, tokenIds.length, 0n);
  return hashes;
}

/**
 * Batch-return permissionless rentals for a borrower via Multicall3 (1 tx).
 * GC reward goes to Multicall3, not the caller.
 */
export async function returnPermissionlessBatch(
  signer: Signer,
  tokenIds: bigint[],
): Promise<string> {
  if (tokenIds.length === 0) throw new Error("No permissionless rentals to return");

  const iface = new Interface(ENTERPRISE_ABI);
  const calls = tokenIds.map((tokenId) => ({
    target: ADDRESSES.enterprise,
    allowFailure: true,
    callData: iface.encodeFunctionData("returnRental", [tokenId]),
  }));

  const mc3 = new Contract(ADDRESSES.multicall3, MULTICALL3_ABI, signer);
  const tx = await mc3.aggregate3(calls);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

/** List token IDs of a borrower that are past enterpriseOnlyCollectionTime. */
export async function fetchPermissionlessTokenIds(
  provider: Provider,
  owner: string,
): Promise<bigint[]> {
  const rentalToken = rentalTokenContract(provider);
  const enterprise = enterpriseContract(provider);
  const t = nowSec();
  const balance = Number((await rentalToken.balanceOf(owner)) as bigint);
  const out: bigint[] = [];

  for (let i = 0; i < balance; i++) {
    const tokenId = (await rentalToken.tokenOfOwnerByIndex(owner, i)) as bigint;
    const raw = await enterprise.getRentalAgreement(tokenId);
    const a = parseAgreement(raw);
    if (a.enterpriseOnlyCollectionTime < t) out.push(tokenId);
  }
  return out;
}
