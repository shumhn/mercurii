import { scrypt } from "@noble/hashes/scrypt";
import { Buffer } from "buffer";
import { signMessage, type BrowserWallet } from "./mercurii-wallet";

export type EncryptedRoster = {
  version: 1; algorithm: "aes-256-gcm+scrypt";
  salt: string; iv: string; tag: string; ciphertext: string;
};

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const decode = (value: string) => Uint8Array.from(Buffer.from(value, "base64url"));

function rosterKey(passphrase: string, salt: Uint8Array): Uint8Array {
  if (passphrase.length < 12) throw new Error("Roster passphrase needs at least 12 characters");
  return scrypt(new TextEncoder().encode(passphrase), salt, { N: 16384, r: 8, p: 1, dkLen: 32 });
}

export async function sealRoster(roster: unknown, passphrase: string): Promise<EncryptedRoster> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(rosterKey(passphrase, salt)), "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    new TextEncoder().encode(JSON.stringify(roster))));
  return { version: 1, algorithm: "aes-256-gcm+scrypt", salt: encode(salt), iv: encode(iv),
    tag: encode(encrypted.slice(-16)), ciphertext: encode(encrypted.slice(0, -16)) };
}

export async function openRoster(envelope: EncryptedRoster, passphrase: string): Promise<unknown> {
  if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm+scrypt") throw new Error("Unsupported roster encryption");
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(rosterKey(passphrase, decode(envelope.salt))), "AES-GCM", false, ["decrypt"]);
  const ciphertext = decode(envelope.ciphertext);
  const tag = decode(envelope.tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext); combined.set(tag, ciphertext.length);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv) }, key, combined);
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, stable(item)]));
  return value;
}

export async function signSchedule(wallet: BrowserWallet, operation: "create" | "update" | "launch",
  company: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { signature: _signature, ...unsigned } = body;
  void _signature;
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(JSON.stringify(stable(unsigned))))).toString("hex");
  const signature = await signMessage(wallet, `Mercury payroll schedule v1\n${operation}\n${company}\n${hash}`);
  return { ...unsigned, signature };
}
