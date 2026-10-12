import { Buffer } from "buffer";
import bs58 from "bs58";
import { Transaction, VersionedTransaction } from "@solana/web3.js";

export type BrowserWallet = {
  publicKey?: { toBase58(): string };
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?(): Promise<void>;
  on?(event: "accountChanged" | "disconnect", listener: (...args: unknown[]) => void): void;
  off?(event: "accountChanged" | "disconnect", listener: (...args: unknown[]) => void): void;
  signMessage?(message: Uint8Array): Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction?(transaction: Transaction | VersionedTransaction): Promise<Transaction | VersionedTransaction>;
};

declare global {
  interface Window {
    phantom?: { solana?: BrowserWallet };
    solflare?: BrowserWallet;
    solana?: BrowserWallet;
  }
}

export function installedWallet(): BrowserWallet | null {
  if (typeof window === "undefined") return null;
  return window.phantom?.solana ?? window.solflare ?? window.solana ?? null;
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
