import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { asAddress } from "./magicblock.ts";

export type PrivateEnvelope = { iv: string; tag: string; ciphertext: string };
export type MercuryCompany = {
  companyId: string; founderWallet: string; policyAddress: string; mintAddress: string; perValidator: string;
};
export type CompanyMemberCache = {
  walletAddress: string;
  grantAddress: string;
  role: "founder" | "finance" | "manager" | "requester" | "viewer" | "agent";
  state: "invited" | "active" | "revoked";
  privateRecordId?: string | null;
};
export type PrivateRecord = {
  companyId: string; domain: string; recordId: string; payload: unknown;
  metadata?: Record<string, string | number | boolean | null>;
};
export type VersionedPrivateRecord<T> = T & {
  metadata: Record<string, string | number | boolean | null>; recordVersion: number;
};

type DatabaseRow = {
  company_id: string; domain: string; record_id: string; envelope: PrivateEnvelope;
  metadata: Record<string, string | number | boolean | null>; record_version: number;
  created_at: string; updated_at: string;
};
type RecoveryRow = { company_id: string; checkpoint_id: string; envelope: PrivateEnvelope; created_at: string };
type FetchLike = typeof fetch;

const DEFAULT_KEY_FILE = new URL("../.state/supabase-records.key", import.meta.url).pathname;

function privateKey(path = process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE ?? DEFAULT_KEY_FILE): Buffer {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const info = lstatSync(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Supabase record key must be a private regular file");
  const bytes = readFileSync(path);
  if (bytes.length !== 32) throw new Error("Supabase record key must contain exactly 32 bytes");
  return bytes;
}

function recordPart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function domain(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(value)) throw new Error("Invalid record domain");
  return value;
}

function aad(company: string, recordDomain: string, recordId: string): string {
  return `mercury:supabase:v1:${company}:${recordDomain}:${recordId}`;
}

export function encryptPrivateRecord(value: unknown, company: string, recordDomain: string, recordId: string): PrivateEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", privateKey(), iv);
  cipher.setAAD(Buffer.from(aad(company, recordDomain, recordId)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}

export function decryptPrivateRecord<T>(envelope: PrivateEnvelope, company: string, recordDomain: string, recordId: string): T {
  if (!envelope || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") {
    throw new Error("Invalid encrypted private record");
  }
  const decipher = createDecipheriv("aes-256-gcm", privateKey(), Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(Buffer.from(aad(company, recordDomain, recordId)));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final(),
  ]).toString("utf8")) as T;
}

export class SupabasePrivateStore {
  readonly #url: URL;
  readonly #secret: string;
  readonly #fetch: FetchLike;

  constructor(args: { url: string; secret: string; fetch?: FetchLike }) {
    this.#url = new URL(args.url);
    if (this.#url.protocol !== "https:") throw new Error("Supabase URL must use HTTPS");
    if (!args.secret || args.secret.length < 20) throw new Error("Supabase server secret is required");
    this.#secret = args.secret;
    this.#fetch = args.fetch ?? fetch;
  }

  static fromEnvironment(fetcher?: FetchLike): SupabasePrivateStore | null {
    const url = process.env.MERCURY_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.MERCURY_SUPABASE_SECRET_KEY;
    if (!url && !secret) return null;
    if (!url || !secret) throw new Error("Set both MERCURY_SUPABASE_URL and MERCURY_SUPABASE_SECRET_KEY");
    return new SupabasePrivateStore({ url, secret, fetch: fetcher });
  }

  async registerCompany(input: MercuryCompany): Promise<void> {
    const companyId = asAddress(input.companyId, "companyId");
    const body = {
      company_id: companyId,
      founder_wallet: asAddress(input.founderWallet, "founderWallet"),
      policy_address: asAddress(input.policyAddress, "policyAddress"),
      mint_address: asAddress(input.mintAddress, "mintAddress"),
      per_validator: asAddress(input.perValidator, "perValidator"),
      updated_at: new Date().toISOString(),
    };
    await this.#request("POST", "/rest/v1/mercury_companies?on_conflict=company_id", body,
      "resolution=merge-duplicates,return=minimal");
  }

  /**
   * Stores a non-authoritative app directory index. It deliberately contains
   * no grant caps, recipients, scopes, balances, payroll data, or display
   * names. Payment routes still read and validate TeamGrant on the PER.
   */
  async upsertCompanyMemberCache(companyInput: string, entries: CompanyMemberCache[]): Promise<void> {
    const companyId = asAddress(companyInput, "companyId");
    if (entries.length === 0) return;
    const body = entries.map((entry) => ({
      company_id: companyId,
      wallet_address: asAddress(entry.walletAddress, "member wallet"),
      grant_address: asAddress(entry.grantAddress, "grant address"),
      role_cache: entry.role,
      membership_state: entry.state,
      private_record_id: entry.privateRecordId ? recordPart(entry.privateRecordId, "private record ID") : null,
      updated_at: new Date().toISOString(),
    }));
    await this.#request("POST", "/rest/v1/mercury_company_members?on_conflict=company_id,wallet_address,grant_address", body,
      "resolution=merge-duplicates,return=minimal");
  }

  /** Saves only a reconciliation position; details belong in encrypted records. */
  async upsertSyncCursor(input: {
    companyId: string;
    stream: "base-chain" | "per-state" | "payment-reconciliation" | "notifications";
    cursorValue?: string | null;
    observedSlot?: number | null;
    state: "idle" | "running" | "degraded" | "blocked";
    privateRecordId?: string | null;
  }): Promise<void> {
    const companyId = asAddress(input.companyId, "companyId");
    if (input.observedSlot !== undefined && input.observedSlot !== null &&
        (!Number.isSafeInteger(input.observedSlot) || input.observedSlot < 0)) {
      throw new Error("observedSlot must be a non-negative safe integer");
    }
    await this.#request("POST", "/rest/v1/mercury_operation_sync_cursors?on_conflict=company_id,stream", {
      company_id: companyId, stream: input.stream, cursor_value: input.cursorValue ?? null,
      observed_slot: input.observedSlot ?? null, state: input.state,
      private_record_id: input.privateRecordId ? recordPart(input.privateRecordId, "private record ID") : null,
      updated_at: new Date().toISOString(),
    }, "resolution=merge-duplicates,return=minimal");
  }

  /** Inserts an encrypted record once. A competing request cannot overwrite it. */
  async insertIfAbsent(input: PrivateRecord): Promise<boolean> {
    const companyId = asAddress(input.companyId, "companyId");
    const recordDomain = domain(input.domain);
    const recordId = recordPart(input.recordId, "record ID");
    const body = { company_id: companyId, domain: recordDomain, record_id: recordId,
      envelope: encryptPrivateRecord(input.payload, companyId, recordDomain, recordId),
      metadata: input.metadata ?? {}, record_version: 1, updated_at: new Date().toISOString() };
    const rows = await this.#request<DatabaseRow[]>("POST",
      "/rest/v1/mercury_private_records?on_conflict=company_id,domain,record_id", body,
      "resolution=ignore-duplicates,return=representation");
    return rows.length === 1;
  }

  async put(input: PrivateRecord): Promise<void> {
    const companyId = asAddress(input.companyId, "companyId");
    const recordDomain = domain(input.domain);
    const recordId = recordPart(input.recordId, "record ID");
    const metadata = input.metadata ?? {};
    const body = { company_id: companyId, domain: recordDomain, record_id: recordId,
      envelope: encryptPrivateRecord(input.payload, companyId, recordDomain, recordId), metadata,
      updated_at: new Date().toISOString() };
    await this.#request("POST", "/rest/v1/mercury_private_records?on_conflict=company_id,domain,record_id", body,
      "resolution=merge-duplicates,return=minimal");
  }

  async get<T>(companyInput: string, domainInput: string, recordIdInput: string): Promise<VersionedPrivateRecord<T> | null> {
    const companyId = asAddress(companyInput, "companyId");
    const recordDomain = domain(domainInput);
    const recordId = recordPart(recordIdInput, "record ID");
    const rows = await this.#request<DatabaseRow[]>("GET", `/rest/v1/mercury_private_records?company_id=eq.${encodeURIComponent(companyId)}&domain=eq.${encodeURIComponent(recordDomain)}&record_id=eq.${encodeURIComponent(recordId)}&select=company_id,domain,record_id,envelope,metadata,record_version,created_at,updated_at`);
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return { ...decryptPrivateRecord<T>(row.envelope, companyId, recordDomain, recordId), metadata: row.metadata,
      recordVersion: row.record_version };
  }

  /** Writes only if the encrypted record still has the expected optimistic version. */
  async compareAndSwap(input: PrivateRecord & { expectedVersion: number }): Promise<number | null> {
    const companyId = asAddress(input.companyId, "companyId");
    const recordDomain = domain(input.domain);
    const recordId = recordPart(input.recordId, "record ID");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Expected record version must be a positive safe integer");
    }
    const nextVersion = input.expectedVersion + 1;
    const rows = await this.#request<DatabaseRow[]>("PATCH",
      `/rest/v1/mercury_private_records?company_id=eq.${encodeURIComponent(companyId)}&domain=eq.${encodeURIComponent(recordDomain)}&record_id=eq.${encodeURIComponent(recordId)}&record_version=eq.${input.expectedVersion}`,
      { envelope: encryptPrivateRecord(input.payload, companyId, recordDomain, recordId),
        metadata: input.metadata ?? {}, record_version: nextVersion, updated_at: new Date().toISOString() },
      "return=representation");
    return rows.length === 1 ? nextVersion : null;
  }

  async list<T>(companyInput: string, domainInput: string, limit = 100): Promise<Array<T & { recordId: string; metadata: DatabaseRow["metadata"] }>> {
    const companyId = asAddress(companyInput, "companyId");
    const recordDomain = domain(domainInput);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Record limit must be 1 to 500");
    const rows = await this.#request<DatabaseRow[]>("GET", `/rest/v1/mercury_private_records?company_id=eq.${encodeURIComponent(companyId)}&domain=eq.${encodeURIComponent(recordDomain)}&select=company_id,domain,record_id,envelope,metadata,record_version,created_at,updated_at&order=updated_at.desc&limit=${limit}`);
    return rows.map((row) => ({ ...decryptPrivateRecord<T>(row.envelope, companyId, recordDomain, row.record_id),
      recordId: row.record_id, metadata: row.metadata, recordVersion: row.record_version }));
  }

  async appendAuditEvent(input: { companyId: string; eventId: string; eventType: string; payload: unknown }): Promise<void> {
    const companyId = asAddress(input.companyId, "companyId");
    const eventId = recordPart(input.eventId, "event ID");
    const eventType = domain(input.eventType);
    await this.#request("POST", "/rest/v1/mercury_private_audit_events?on_conflict=company_id,event_id", {
      company_id: companyId, event_id: eventId, event_type: eventType,
      envelope: encryptPrivateRecord(input.payload, companyId, `audit.${eventType}`, eventId),
    }, "resolution=ignore-duplicates,return=minimal");
  }

  async createRecoveryCheckpoint(input: { companyId: string; checkpointId: string; payload: unknown }): Promise<void> {
    const companyId = asAddress(input.companyId, "companyId");
    const checkpointId = recordPart(input.checkpointId, "checkpoint ID");
    await this.#request("POST", "/rest/v1/mercury_recovery_checkpoints?on_conflict=company_id,checkpoint_id", {
      company_id: companyId, checkpoint_id: checkpointId,
      envelope: encryptPrivateRecord(input.payload, companyId, "recovery.checkpoint", checkpointId),
    }, "resolution=merge-duplicates,return=minimal");
  }

  async getRecoveryCheckpoint<T>(companyInput: string, checkpointInput: string): Promise<T | null> {
    const companyId = asAddress(companyInput, "companyId");
    const checkpointId = recordPart(checkpointInput, "checkpoint ID");
    const rows = await this.#request<RecoveryRow[]>("GET", `/rest/v1/mercury_recovery_checkpoints?company_id=eq.${encodeURIComponent(companyId)}&checkpoint_id=eq.${encodeURIComponent(checkpointId)}&select=company_id,checkpoint_id,envelope,created_at`);
    if (rows.length === 0) return null;
    return decryptPrivateRecord<T>(rows[0]!.envelope, companyId, "recovery.checkpoint", checkpointId);
  }

  /** Atomically marks a pending opaque record as consumed. Payload remains encrypted and unchanged. */
  async claimPendingRecord(companyInput: string, domainInput: string, recordIdInput: string,
    kind: string): Promise<boolean> {
    const companyId = asAddress(companyInput, "companyId");
    const recordDomain = domain(domainInput);
    const recordId = recordPart(recordIdInput, "record ID");
    const recordKind = domain(kind);
    const rows = await this.#request<DatabaseRow[]>("PATCH",
      `/rest/v1/mercury_private_records?company_id=eq.${encodeURIComponent(companyId)}&domain=eq.${encodeURIComponent(recordDomain)}&record_id=eq.${encodeURIComponent(recordId)}&metadata-%3E%3Estate=eq.pending`,
      { metadata: { kind: recordKind, state: "consumed", consumed_at: new Date().toISOString() } },
      "return=representation");
    return rows.length === 1;
  }

  async healthcheck(): Promise<void> {
    await this.#request("GET", "/rest/v1/mercury_companies?select=company_id&limit=1");
  }

  async #request<T = unknown>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
    const response = await this.#fetch(new URL(path, this.#url).toString(), {
      method,
      headers: {
        apikey: this.#secret,
        authorization: `Bearer ${this.#secret}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(prefer ? { prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      let code = "unknown";
      try { code = String((await response.json() as { code?: unknown }).code ?? response.status); }
      catch { code = String(response.status); }
      throw new Error(`Supabase request failed (${code})`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
