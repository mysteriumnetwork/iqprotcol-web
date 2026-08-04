/** Minimal ABIs for Enterprise, StakeToken, RentalToken, Multicall3. */

export const ENTERPRISE_ABI = [
  "function getReserve() view returns (uint256)",
  "function getUsedReserve() view returns (uint256)",
  "function getAvailableReserve() view returns (uint256)",
  "function getStake(uint256 stakeTokenId) view returns (tuple(uint256 amount, uint256 shares, uint256 block))",
  "function getStakingReward(uint256 stakeTokenId) view returns (uint256)",
  "function unstake(uint256 stakeTokenId)",
  "function claimStakingReward(uint256 stakeTokenId)",
  "function getRentalAgreement(uint256 rentalTokenId) view returns (uint112 rentalAmount, uint16 powerTokenIndex, uint32 startTime, uint32 endTime, uint32 renterOnlyReturnTime, uint32 enterpriseOnlyCollectionTime, uint112 gcRewardAmount, uint16 gcRewardTokenIndex)",
  "function returnRental(uint256 rentalTokenId)",
] as const;

export const STAKE_TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
] as const;

export const RENTAL_TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
] as const;

export const MULTICALL3_ABI = [
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
] as const;
