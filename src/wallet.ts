import { BrowserProvider, type Eip1193Provider, type Signer } from "ethers";
import { POLYGON_CHAIN_ID, POLYGON_NETWORK } from "./config";

export type WalletState = {
  address: string;
  chainId: number;
  provider: BrowserProvider;
  signer: Signer;
};

function getInjected(): Eip1193Provider {
  if (!window.ethereum) {
    throw new Error(
      "No wallet detected. Install MetaMask, Brave Wallet, or another browser extension.",
    );
  }
  return window.ethereum;
}

export async function connectWallet(): Promise<WalletState> {
  const injected = getInjected();
  const provider = new BrowserProvider(injected);
  await provider.send("eth_requestAccounts", []);
  await ensurePolygon(provider);
  return readWalletState(provider);
}

export async function readWalletState(
  provider?: BrowserProvider,
): Promise<WalletState> {
  const browserProvider = provider ?? new BrowserProvider(getInjected());
  const signer = await browserProvider.getSigner();
  const address = await signer.getAddress();
  const network = await browserProvider.getNetwork();
  return {
    address,
    chainId: Number(network.chainId),
    provider: browserProvider,
    signer,
  };
}

export async function ensurePolygon(provider: BrowserProvider): Promise<void> {
  const network = await provider.getNetwork();
  if (Number(network.chainId) === POLYGON_CHAIN_ID) return;

  const injected = getInjected() as Eip1193Provider & {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: POLYGON_NETWORK.chainId }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    // 4902 = chain not added to wallet
    if (code === 4902) {
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [POLYGON_NETWORK],
      });
    } else {
      throw err;
    }
  }
}

export function onAccountsChanged(handler: (accounts: string[]) => void): () => void {
  const injected = window.ethereum;
  if (!injected?.on) return () => undefined;

  const listener = (...args: unknown[]) => {
    handler((args[0] as string[]) ?? []);
  };
  injected.on("accountsChanged", listener);
  return () => injected.removeListener?.("accountsChanged", listener);
}

export function onChainChanged(handler: () => void): () => void {
  const injected = window.ethereum;
  if (!injected?.on) return () => undefined;

  const listener = () => handler();
  injected.on("chainChanged", listener);
  return () => injected.removeListener?.("chainChanged", listener);
}
