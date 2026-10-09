import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export type EncryptedPayrollRoster = {
  version: 1; algorithm: "aes-256-gcm+scrypt";
  salt: string; iv: string; tag: string; ciphertext: string;
};

function bytes(value: unknown, name: string, length?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${name}`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || (length !== undefined && decoded.length !== length) ||
      decoded.toString("base64url") !== value) throw new Error(`Invalid ${name}`);
  return decoded;
}

export function validateEncryptedPayrollRoster(value: unknown): EncryptedPayrollRoster {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Encrypted roster is required");
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || input.algorithm !== "aes-256-gcm+scrypt") throw new Error("Unsupported roster encryption");
  bytes(input.salt, "roster salt", 16);
  bytes(input.iv, "roster IV", 12);
  bytes(input.tag, "roster tag", 16);
  if (bytes(input.ciphertext, "roster ciphertext").length > 64_000) throw new Error("Encrypted roster exceeds 64 KB");
  return input as EncryptedPayrollRoster;
}

export function sealPayrollRoster(roster: unknown, passphrase: string): EncryptedPayrollRoster {
  if (typeof passphrase !== "string" || passphrase.length < 12) throw new Error("Roster passphrase must have at least 12 characters");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(roster), "utf8"), cipher.final()]);
  return validateEncryptedPayrollRoster({ version: 1, algorithm: "aes-256-gcm+scrypt",
    salt: salt.toString("base64url"), iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") });
}

export function openPayrollRoster(value: unknown, passphrase: string): unknown {
  const envelope = validateEncryptedPayrollRoster(value);
  const key = scryptSync(passphrase, Buffer.from(envelope.salt, "base64url"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final()]).toString("utf8")) as unknown;
}
