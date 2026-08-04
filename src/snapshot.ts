import type { AllStakersSnapshot, StakerRow } from "./pool";
import type { AllBorrowersSnapshot, BorrowerRow } from "./rentals";

/** On-disk / HTTP format (bigint fields as decimal strings). */
export type StakersSnapshotFile = {
  version: 1;
  chainId: number;
  enterprise: string;
  stakeToken: string;
  /** ISO-8601 UTC when the scan finished. */
  updatedAt: string;
  blockNumber: number | null;
  elapsedMs: number;
  positionCount: number;
  stakerCount: number;
  totalInitial: string;
  totalReward: string;
  totalCurrent: string;
  stakers: Array<{
    address: string;
    positionCount: number;
    totalInitial: string;
    totalReward: string;
    totalCurrent: string;
  }>;
};

export function snapshotToFile(
  snap: AllStakersSnapshot,
  meta: {
    chainId: number;
    enterprise: string;
    stakeToken: string;
    blockNumber: number | null;
    updatedAt?: string;
  },
): StakersSnapshotFile {
  return {
    version: 1,
    chainId: meta.chainId,
    enterprise: meta.enterprise,
    stakeToken: meta.stakeToken,
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
    blockNumber: meta.blockNumber,
    elapsedMs: snap.elapsedMs,
    positionCount: snap.positionCount,
    stakerCount: snap.stakerCount,
    totalInitial: snap.totalInitial.toString(),
    totalReward: snap.totalReward.toString(),
    totalCurrent: snap.totalCurrent.toString(),
    stakers: snap.stakers.map((s) => ({
      address: s.address,
      positionCount: s.positionCount,
      totalInitial: s.totalInitial.toString(),
      totalReward: s.totalReward.toString(),
      totalCurrent: s.totalCurrent.toString(),
    })),
  };
}

export function fileToSnapshot(file: StakersSnapshotFile): AllStakersSnapshot {
  const stakers: StakerRow[] = file.stakers.map((s) => ({
    address: s.address,
    positionCount: s.positionCount,
    totalInitial: BigInt(s.totalInitial),
    totalReward: BigInt(s.totalReward),
    totalCurrent: BigInt(s.totalCurrent),
  }));

  return {
    stakers,
    positionCount: file.positionCount,
    stakerCount: file.stakerCount,
    totalInitial: BigInt(file.totalInitial),
    totalReward: BigInt(file.totalReward),
    totalCurrent: BigInt(file.totalCurrent),
    elapsedMs: file.elapsedMs,
  };
}

export function isStakersSnapshotFile(value: unknown): value is StakersSnapshotFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.updatedAt === "string" &&
    Array.isArray(v.stakers) &&
    typeof v.totalCurrent === "string"
  );
}

/** On-disk / HTTP format for rMYST borrowers. */
export type BorrowersSnapshotFile = {
  version: 1;
  chainId: number;
  enterprise: string;
  rentalToken: string;
  updatedAt: string;
  blockNumber: number | null;
  elapsedMs: number;
  positionCount: number;
  borrowerCount: number;
  totalRented: string;
  activeCount: number;
  permissionlessCount: number;
  borrowers: Array<{
    address: string;
    positionCount: number;
    totalRented: string;
    activeCount: number;
    permissionlessCount: number;
    permissionlessAmount: string;
  }>;
};

export function borrowersToFile(
  snap: AllBorrowersSnapshot,
  meta: {
    chainId: number;
    enterprise: string;
    rentalToken: string;
    blockNumber: number | null;
    updatedAt?: string;
  },
): BorrowersSnapshotFile {
  return {
    version: 1,
    chainId: meta.chainId,
    enterprise: meta.enterprise,
    rentalToken: meta.rentalToken,
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
    blockNumber: meta.blockNumber,
    elapsedMs: snap.elapsedMs,
    positionCount: snap.positionCount,
    borrowerCount: snap.borrowerCount,
    totalRented: snap.totalRented.toString(),
    activeCount: snap.activeCount,
    permissionlessCount: snap.permissionlessCount,
    borrowers: snap.borrowers.map((b) => ({
      address: b.address,
      positionCount: b.positionCount,
      totalRented: b.totalRented.toString(),
      activeCount: b.activeCount,
      permissionlessCount: b.permissionlessCount,
      permissionlessAmount: b.permissionlessAmount.toString(),
    })),
  };
}

export function fileToBorrowers(file: BorrowersSnapshotFile): AllBorrowersSnapshot {
  const borrowers: BorrowerRow[] = file.borrowers.map((b) => ({
    address: b.address,
    positionCount: b.positionCount,
    totalRented: BigInt(b.totalRented),
    activeCount: b.activeCount,
    permissionlessCount: b.permissionlessCount,
    permissionlessAmount: BigInt(b.permissionlessAmount),
  }));

  return {
    borrowers,
    positionCount: file.positionCount,
    borrowerCount: file.borrowerCount,
    totalRented: BigInt(file.totalRented),
    activeCount: file.activeCount,
    permissionlessCount: file.permissionlessCount,
    elapsedMs: file.elapsedMs,
  };
}

export function isBorrowersSnapshotFile(value: unknown): value is BorrowersSnapshotFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.updatedAt === "string" &&
    Array.isArray(v.borrowers) &&
    typeof v.totalRented === "string"
  );
}
