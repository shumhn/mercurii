import { Buffer } from "buffer";
import bs58 from "bs58";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, StandardDisconnect, StandardEvents } from "@wallet-standard/features";
import { SolanaSignMessage, SolanaSignTransaction } from "@solana/wallet-standard-features";

type PublicKeyLike = { toBase58(): string };
type WalletListener = (...args: unknown[]) => void;

export type BrowserWallet = {
  publicKey?: PublicKeyLike;
  connect(): Promise<{ publicKey: PublicKeyLike }>;
  disconnect?(): Promise<void>;
  on?(event: "accountChanged" | "disconnect", listener: WalletListener): void;
  off?(event: "accountChanged" | "disconnect", listener: WalletListener): void;
  signMessage?(message: Uint8Array): Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction?(transaction: Transaction | VersionedTransaction): Promise<Transaction | VersionedTransaction>;
};

export type WalletOption = {
  id: string;
  name: string;
  icon?: string;
  standard: boolean;
  wallet: BrowserWallet;
};

type StandardFeatures = Wallet["features"] & {
  [StandardConnect]?: { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> };
  [StandardDisconnect]?: { disconnect(): Promise<void> };
  [StandardEvents]?: { on(event: "change", listener: (change: { accounts?: readonly WalletAccount[] }) => void): () => void };
  [SolanaSignMessage]?: { signMessage(...inputs: readonly { account: WalletAccount; message: Uint8Array }[]):
    Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]> };
  [SolanaSignTransaction]?: { signTransaction(...inputs: readonly { account: WalletAccount;
    transaction: Uint8Array; chain?: string }[]): Promise<readonly { signedTransaction: Uint8Array }[]> };
};

declare global {
  interface Window {
    phantom?: { solana?: BrowserWallet };
    solflare?: BrowserWallet;
    backpack?: BrowserWallet;
    glowSolana?: BrowserWallet;
    solana?: BrowserWallet & { isPhantom?: boolean; isSolflare?: boolean; isBackpack?: boolean; isGlow?: boolean };
  }
}

const standardAdapters = new WeakMap<Wallet, BrowserWallet>();

function publicKey(address: string): PublicKeyLike {
  return { toBase58: () => address };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function solanaAccount(accounts: readonly WalletAccount[]): WalletAccount | null {
  return accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:")) &&
    account.features.includes(SolanaSignMessage) && account.features.includes(SolanaSignTransaction)) ?? null;
}

function standardAdapter(wallet: Wallet): BrowserWallet | null {
  const cached = standardAdapters.get(wallet);
  if (cached) return cached;
  const features = wallet.features as StandardFeatures;
  if (!features[StandardConnect] || !features[SolanaSignMessage] || !features[SolanaSignTransaction]) return null;
  let account = solanaAccount(wallet.accounts);
  const listeners = { accountChanged: new Set<WalletListener>(), disconnect: new Set<WalletListener>() };
  features[StandardEvents]?.on("change", ({ accounts }) => {
    if (!accounts) return;
    account = solanaAccount(accounts);
    if (account) listeners.accountChanged.forEach((listener) => listener(publicKey(account!.address)));
    else listeners.disconnect.forEach((listener) => listener());
  });
  const adapter: BrowserWallet = {
    get publicKey() { return account ? publicKey(account.address) : undefined; },
    async connect() {
      const result = await features[StandardConnect]!.connect();
      account = solanaAccount(result.accounts);
      if (!account) throw new Error(`${wallet.name} does not expose a Solana account with message and transaction signing`);
      return { publicKey: publicKey(account.address) };
    },
    async disconnect() {
      await features[StandardDisconnect]?.disconnect();
      account = null;
    },
    on(event, listener) { listeners[event].add(listener); },
    off(event, listener) { listeners[event].delete(listener); },
    async signMessage(message) {
      if (!account) throw new Error(`Connect ${wallet.name} before signing`);
      const [result] = await features[SolanaSignMessage]!.signMessage({ account, message });
      if (!result || !sameBytes(result.signedMessage, message)) throw new Error(`${wallet.name} changed the login message before signing`);
      return { signature: Uint8Array.from(result.signature) };
    },
    async signTransaction(transaction) {
      if (!account) throw new Error(`Connect ${wallet.name} before signing`);
      const bytes = transaction instanceof VersionedTransaction ? transaction.serialize() :
        transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [result] = await features[SolanaSignTransaction]!.signTransaction({
        account, transaction: Uint8Array.from(bytes), chain: "solana:devnet",
      });
      if (!result) throw new Error(`${wallet.name} did not return a signed transaction`);
      return transaction instanceof VersionedTransaction ? VersionedTransaction.deserialize(result.signedTransaction) :
        Transaction.from(Buffer.from(result.signedTransaction));
    },
  };
  standardAdapters.set(wallet, adapter);
  return adapter;
}

function legacyWallets(): WalletOption[] {
  if (typeof window === "undefined") return [];
  const candidates: [string, string, BrowserWallet | undefined][] = [
    ["legacy:phantom", "Phantom", window.phantom?.solana],
    ["legacy:solflare", "Solflare", window.solflare],
    ["legacy:backpack", "Backpack", window.backpack],
    ["legacy:glow", "Glow", window.glowSolana],
  ];
  const generic = window.solana;
  if (generic) {
    const name = generic.isSolflare ? "Solflare" : generic.isBackpack ? "Backpack" : generic.isGlow ? "Glow" :
      generic.isPhantom ? "Phantom" : "Solana wallet";
    candidates.push([`legacy:${name.toLowerCase().replaceAll(" ", "-")}`, name, generic]);
  }
  const seen = new Set<BrowserWallet>();
  return candidates.flatMap(([id, name, wallet]) => wallet && !seen.has(wallet) ?
    (seen.add(wallet), [{ id, name, standard: false, wallet }]) : []);
}

export function installedWallets(): WalletOption[] {
  if (typeof window === "undefined") return [];
  const standard = getWallets().get().flatMap((wallet) => {
    const adapter = standardAdapter(wallet);
    return adapter ? [{ id: `standard:${wallet.name}`, name: wallet.name, icon: wallet.icon,
      standard: true, wallet: adapter } satisfies WalletOption] : [];
  });
  const names = new Set(standard.map((option) => option.name.toLowerCase()));
  return [...standard, ...legacyWallets().filter((option) => !names.has(option.name.toLowerCase()))];
}

export function watchInstalledWallets(listener: (wallets: WalletOption[]) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const wallets = getWallets();
  const update = () => listener(installedWallets());
  const offRegister = wallets.on("register", update);
  const offUnregister = wallets.on("unregister", update);
  update();
  return () => { offRegister(); offUnregister(); };
}

export async function signMessage(wallet: BrowserWallet, message: string): Promise<string> {
  if (!wallet.signMessage) throw new Error("This wallet cannot sign login messages");
  const signed = await wallet.signMessage(new TextEncoder().encode(message));
  const bytes = signed instanceof Uint8Array ? signed : signed.signature;
  if (!(bytes instanceof Uint8Array)) throw new Error("Wallet returned an invalid signature");
  return bs58.encode(bytes);
}

export type PreparedTransaction = {
  operation?: string;
  transactionBase64: string;
  requiredSigners?: string[];
  sendTo: "base" | "ephemeral";
  sendRpcEndpoint?: string;
};

function transactionBytes(base64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("Invalid prepared transaction");
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

export async function signPrepared(wallet: BrowserWallet, address: string, prepared: PreparedTransaction):
  Promise<{ signedTransactionBase64: string; bytes: Uint8Array }> {
  if (!wallet.signTransaction) throw new Error("This wallet cannot sign Solana transactions");
  if (wallet.publicKey?.toBase58() !== address) {
    throw new Error("Wallet account changed. Disconnect and sign in again before signing.");
  }
  if (prepared.requiredSigners && !prepared.requiredSigners.includes(address)) {
    throw new Error("The connected wallet is not a required signer for this step");
  }
  const bytes = transactionBytes(prepared.transactionBase64);
  let transaction: Transaction | VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(bytes);
  } catch {
    transaction = Transaction.from(Buffer.from(bytes));
  }
  const signed = await wallet.signTransaction(transaction);
  const serialized = Uint8Array.from(signed.serialize());
  return { signedTransactionBase64: Buffer.from(serialized).toString("base64"), bytes: serialized };
}
