import { Contract, JsonRpcProvider, type Provider, type Signer } from "ethers";
import { ENTERPRISE_ABI, STAKE_TOKEN_ABI } from "./abis";
import { ADDRESSES, PUBLIC_RPC_URL } from "./config";

export type PoolStats = {
  reserve: bigint;
  usedReserve: bigint;
  availableReserve: bigint;
};

export type StakePosition = {
  tokenId: bigint;
  /** Principal amount locked when the position was created / last increased. */
  initialStaked: bigint;
  shares: bigint;
  /** Accrued reward above principal. */
  reward: bigint;
  /** Principal + reward currently withdrawable via unstake (if liquidity allows). */
  currentValue: bigint;
};

export type UserStakes = {
  positions: StakePosition[];
  totalInitial: bigint;
  totalReward: bigint;
  totalCurrent: bigint;
  positionCount: number;
};

function enterpriseContract(runner: Provider | Signer): Contract {
  return new Contract(ADDRESSES.enterprise, ENTERPRISE_ABI, runner);
}

function stakeTokenContract(runner: Provider | Signer): Contract {
  return new Contract(ADDRESSES.stakeToken, STAKE_TOKEN_ABI, runner);
}

/** Read-only provider that does not require a wallet. */
export function publicProvider(): JsonRpcProvider {
  return new JsonRpcProvider(PUBLIC_RPC_URL, 137);
}

export async function fetchPoolStats(provider: Provider): Promise<PoolStats> {
  const enterprise = enterpriseContract(provider);
  const [reserve, usedReserve, availableReserve] = await Promise.all([
    enterprise.getReserve() as Promise<bigint>,
    enterprise.getUsedReserve() as Promise<bigint>,
    enterprise.getAvailableReserve() as Promise<bigint>,
  ]);
  return { reserve, usedReserve, availableReserve };
}

export async function fetchUserStakes(
  provider: Provider,
  owner: string,
): Promise<UserStakes> {
  const stakeToken = stakeTokenContract(provider);
  const enterprise = enterpriseContract(provider);

  const balance = (await stakeToken.balanceOf(owner)) as bigint;
  const count = Number(balance);
  const positions: StakePosition[] = [];

  for (let i = 0; i < count; i++) {
    const tokenId = (await stakeToken.tokenOfOwnerByIndex(owner, i)) as bigint;
    const stakeRaw = await enterprise.getStake(tokenId);
    const { initialStaked, shares } = parseStake(
      stakeRaw as Parameters<typeof parseStake>[0],
    );
    const reward = BigInt(await enterprise.getStakingReward(tokenId));
    positions.push({
      tokenId,
      initialStaked,
      shares,
      reward,
      currentValue: initialStaked + reward,
    });
  }

  let totalInitial = 0n;
  let totalReward = 0n;
  let totalCurrent = 0n;
  for (const p of positions) {
    totalInitial += p.initialStaked;
    totalReward += p.reward;
    totalCurrent += p.currentValue;
  }

  return {
    positions,
    totalInitial,
    totalReward,
    totalCurrent,
    positionCount: positions.length,
  };
}

export type StakerRow = {
  address: string;
  positionCount: number;
  totalInitial: bigint;
  totalReward: bigint;
  totalCurrent: bigint;
};

export type AllStakersSnapshot = {
  stakers: StakerRow[];
  positionCount: number;
  stakerCount: number;
  totalInitial: bigint;
  totalReward: bigint;
  totalCurrent: bigint;
  /** Wall-clock ms spent enumerating. */
  elapsedMs: number;
};

const ENUM_CHUNK = 25;

function parseStake(raw: {
  amount?: bigint;
  shares?: bigint;
  0?: bigint;
  1?: bigint;
}): { initialStaked: bigint; shares: bigint } {
  return {
    initialStaked: BigInt(raw.amount ?? raw[0] ?? 0n),
    shares: BigInt(raw.shares ?? raw[1] ?? 0n),
  };
}

/**
 * Enumerate every live sMYST (ERC721Enumerable) and aggregate by owner.
 * No subgraph required — pure on-chain reads. Can take a few seconds if supply is large.
 */
export async function fetchAllStakers(
  provider: Provider,
  onProgress?: (done: number, total: number) => void,
): Promise<AllStakersSnapshot> {
  const started = performance.now();
  const stakeToken = stakeTokenContract(provider);
  const enterprise = enterpriseContract(provider);

  const totalSupply = Number((await stakeToken.totalSupply()) as bigint);
  const byOwner = new Map<
    string,
    { positionCount: number; totalInitial: bigint; totalReward: bigint; totalCurrent: bigint }
  >();

  for (let start = 0; start < totalSupply; start += ENUM_CHUNK) {
    const end = Math.min(start + ENUM_CHUNK, totalSupply);
    const indices = Array.from({ length: end - start }, (_, k) => start + k);

    const tokenIds = await Promise.all(
      indices.map((i) => stakeToken.tokenByIndex(i) as Promise<bigint>),
    );

    const rows = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const [owner, stakeRaw, reward] = await Promise.all([
          stakeToken.ownerOf(tokenId) as Promise<string>,
          enterprise.getStake(tokenId),
          enterprise.getStakingReward(tokenId) as Promise<bigint>,
        ]);
        const { initialStaked } = parseStake(stakeRaw as Parameters<typeof parseStake>[0]);
        const rewardBn = BigInt(reward);
        return {
          owner: owner.toLowerCase(),
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

    onProgress?.(end, totalSupply);
  }

  const stakers: StakerRow[] = [...byOwner.entries()]
    .map(([address, v]) => ({ address, ...v }))
    .sort((a, b) => {
      if (a.totalCurrent === b.totalCurrent) return 0;
      return a.totalCurrent > b.totalCurrent ? -1 : 1;
    });

  let totalInitial = 0n;
  let totalReward = 0n;
  let totalCurrent = 0n;
  for (const s of stakers) {
    totalInitial += s.totalInitial;
    totalReward += s.totalReward;
    totalCurrent += s.totalCurrent;
  }

  return {
    stakers,
    positionCount: totalSupply,
    stakerCount: stakers.length,
    totalInitial,
    totalReward,
    totalCurrent,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/**
 * Unstake every sMYST position owned by the signer.
 * Sequential: each unstake burns one NFT and transfers principal + reward.
 * Fails if available pool liquidity is insufficient for a position.
 */
export async function unstakeAll(
  signer: Signer,
  tokenIds: bigint[],
  onProgress?: (done: number, total: number, tokenId: bigint) => void,
): Promise<string[]> {
  const enterprise = enterpriseContract(signer);
  const hashes: string[] = [];

  for (let i = 0; i < tokenIds.length; i++) {
    const tokenId = tokenIds[i]!;
    onProgress?.(i, tokenIds.length, tokenId);
    const tx = await enterprise.unstake(tokenId);
    const receipt = await tx.wait();
    hashes.push(receipt?.hash ?? tx.hash);
  }

  onProgress?.(tokenIds.length, tokenIds.length, 0n);
  return hashes;
}
