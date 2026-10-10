import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { asAddress } from "./magicblock.ts";
import { mirrorCompanyJournal } from "./supabase-journal-persistence.ts";

export type AuditBundle = {
  version: 1;
  company: string;
  generatedAt: string;
  period: { from: string | null; to: string | null };
  payrollRuns: unknown[];
};

export type AuditShare = {
  auditId: string;
  company: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  period: { from: string | null; to: string | null };
};

export type AuditEvent = {
  eventId: string;
  company: string;
  auditId: string;
  action: "created" | "opened" | "revoked";
  actor: string;
  at: string;
};

type StoredAuditShare = AuditShare & {
  tokenHash: string;
  envelope: { salt: string; iv: string; tag: string; ciphertext: string };
};
type Journal = { version: 1; audits: StoredAuditShare[]; events: AuditEvent[] };

const DEFAULT_PATH = new URL("../.state/compliance-audits.json", import.meta.url).pathname;
const path = () => process.env.MERCURY_COMPLIANCE_AUDIT_JOURNAL ?? DEFAULT_PATH;

function validIso(value: unknown, name: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  return value;
}

function auditId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("auditId must be a UUID v4");
  }
  return value.toLowerCase();
}

function readJournal(): Journal {
  try {
    const value = JSON.parse(readFileSync(path(), "utf8")) as Journal;
    if (value.version !== 1 || !Array.isArray(value.audits) || (value.events !== undefined && !Array.isArray(value.events))) {
      throw new Error("Invalid compliance audit journal");
    }
    return { ...value, events: value.events ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, audits: [], events: [] };
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const destination = path();
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, destination);
  mirrorCompanyJournal({ domain: "compliance-audits", journal, rowKeys: ["audits", "events"] });
}

function digest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function encrypt(bundle: AuditBundle, token: string): StoredAuditShare["envelope"] {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(token, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()]);
  return { salt: salt.toString("base64url"), iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}

function decrypt(envelope: StoredAuditShare["envelope"], token: string): AuditBundle {
  const key = scryptSync(token, Buffer.from(envelope.salt, "base64url"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final(),
  ]).toString("utf8")) as AuditBundle;
}

function publicShare(record: StoredAuditShare): AuditShare {
  const { tokenHash: _tokenHash, envelope: _envelope, ...share } = record;
  void _tokenHash;
  void _envelope;
  return share;
}

export function createAuditShare(input: {
  company: string; label?: unknown; expiresAt: unknown;
  period?: { from?: unknown; to?: unknown }; actor: string; bundle: AuditBundle;
}): { share: AuditShare; token: string } {
  const company = asAddress(input.company, "company");
  const expiresAt = validIso(input.expiresAt, "expiresAt")!;
  if (Date.parse(expiresAt) <= Date.now()) throw new Error("Audit link expiry must be in the future");
  const label = input.label === undefined || input.label === null || input.label === "" ? null : input.label;
  if (typeof label !== "string" || label.length > 120) throw new Error("Audit label must be at most 120 characters");
  const from = validIso(input.period?.from ?? null, "period.from", true);
  const to = validIso(input.period?.to ?? null, "period.to", true);
  if (from && to && Date.parse(from) > Date.parse(to)) throw new Error("Audit period ends before it starts");
  if (input.bundle.version !== 1 || input.bundle.company !== company || !Array.isArray(input.bundle.payrollRuns)) {
    throw new Error("Invalid audit bundle");
  }
  const serialized = JSON.stringify(input.bundle);
  if (Buffer.byteLength(serialized, "utf8") > 512_000) throw new Error("Audit bundle exceeds 512 KB");
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const record: StoredAuditShare = {
    auditId: randomUUID(), company, label, createdAt: now, expiresAt, revokedAt: null,
    accessCount: 0, lastAccessedAt: null, period: { from, to }, tokenHash: digest(token), envelope: encrypt(input.bundle, token),
  };
  const journal = readJournal();
  journal.audits.push(record);
  journal.events.push({ eventId: randomUUID(), company, auditId: record.auditId,
    action: "created", actor: asAddress(input.actor, "actor"), at: now });
  saveJournal(journal);
  return { share: publicShare(record), token };
}

export function listAuditShares(companyInput: unknown): AuditShare[] {
  const company = asAddress(companyInput, "company");
  return readJournal().audits.filter((share) => share.company === company)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(publicShare);
}

export function listAuditEvents(companyInput: unknown, idInput?: unknown): AuditEvent[] {
  const company = asAddress(companyInput, "company");
  const audit = idInput === undefined ? null : auditId(idInput);
  return readJournal().events.filter((event) => event.company === company && (audit === null || event.auditId === audit))
    .sort((left, right) => right.at.localeCompare(left.at));
}

export function revokeAuditShare(companyInput: unknown, idInput: unknown, actorInput: unknown, now = new Date()): AuditShare {
  const company = asAddress(companyInput, "company");
  const id = auditId(idInput);
  const journal = readJournal();
  const share = journal.audits.find((item) => item.company === company && item.auditId === id);
  if (!share) throw new Error("Unknown audit link");
  if (share.revokedAt === null) {
    share.revokedAt = now.toISOString();
    journal.events.push({ eventId: randomUUID(), company, auditId: id, action: "revoked",
      actor: asAddress(actorInput, "actor"), at: share.revokedAt });
    saveJournal(journal);
  }
  return publicShare(share);
}

export function openAuditShare(companyInput: unknown, idInput: unknown, token: unknown,
  now = new Date()): { share: AuditShare; bundle: AuditBundle } {
  const company = asAddress(companyInput, "company");
  const id = auditId(idInput);
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid auditor token");
  const journal = readJournal();
  const share = journal.audits.find((item) => item.company === company && item.auditId === id);
  if (!share || share.revokedAt !== null || Date.parse(share.expiresAt) <= now.getTime()) {
    throw new Error("Audit link is invalid, expired, or revoked");
  }
  const expected = Buffer.from(share.tokenHash, "hex");
  const actual = Buffer.from(digest(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Audit link is invalid, expired, or revoked");
  const bundle = decrypt(share.envelope, token);
  if (bundle.version !== 1 || bundle.company !== company) throw new Error("Audit bundle is invalid");
  share.accessCount += 1;
  share.lastAccessedAt = now.toISOString();
  journal.events.push({ eventId: randomUUID(), company, auditId: id, action: "opened",
    actor: "auditor-capability", at: share.lastAccessedAt });
  saveJournal(journal);
  return { share: publicShare(share), bundle };
}
