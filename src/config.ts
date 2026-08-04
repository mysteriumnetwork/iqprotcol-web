/** Mysterium MYST pool on IQ Protocol (Polygon). */
export const POLYGON_CHAIN_ID = 137;
export const POLYGON_CHAIN_ID_HEX = "0x89";

export const ADDRESSES = {
  enterprise: "0xbF9F6b1D910AA207DaA400931430ef110570F8FF",
  myst: "0x1379E8886A944d2D9d440b3d88DF536Aea08d9F3",
  stakeToken: "0x8aE66d7858578764d573FfB0ece58Db59E569bC1",
  rentalToken: "0xa714cF1267F4a701B646c5CbF660C4B1aCb7A82e",
  /** Multicall3 (standard address on Polygon) — batch returnRental. */
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
} as const;

/** Public Polygon RPC for read-only pool stats (no wallet needed). */
export const PUBLIC_RPC_URL = "https://polygon-bor-rpc.publicnode.com";

export const POLYGON_NETWORK = {
  chainId: POLYGON_CHAIN_ID_HEX,
  chainName: "Polygon Mainnet",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: [PUBLIC_RPC_URL, "https://polygon-rpc.com"],
  blockExplorerUrls: ["https://polygonscan.com"],
};

export const MYST_DECIMALS = 18;
