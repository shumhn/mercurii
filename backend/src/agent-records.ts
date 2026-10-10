import { appendFileSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { AssistantAccess } from "./finance-assistant.ts";
import { mirrorCompanyJournal, schedulePrivateAuditEvent } from "./supabase-journal-persistence.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

type Envelope = { iv: string; tag: string; ciphertext: string };
type SessionData = { requestAddress: string | null; payrollRunId: string | null;
  verifiedAnswers: string[] };
type Session = { id: string; company: string; actor: string; role: AssistantAccess["role"];
  scope: string | null; grant: string | null; updatedAt: string; envelope: Envelope };
type Journal = { version: 1; sessions: Session[] };
export type AgentAuditEntry = { id: string; company: string; actor: string; at: string;
  grant: string | null; event: "tool" | "completed" | "failed";
  tool?: string; details?: unknown };

const defaultKey = new URL("../.state/agent-records.key", import.meta.url).pathname;
const defaultSessions = new URL("../.state/agent-sessions.json", import.meta.url).pathname;
const defaultAudit = new URL("../.state/agent-audit.jsonl", import.meta.url).pathname;
const keyPath = () => process.env.MERCURY_AGENT_RECORDS_KEY_FILE ?? defaultKey;
const sessionPath = () => process.env.MERCURY_AGENT_SESSIONS_JOURNAL ?? defaultSessions;
const auditPath = () => process.env.MERCURY_AGENT_AUDIT_JOURNAL ?? defaultAudit;
const SESSION_MS = 24 * 60 * 60 * 1_000;

function database(): SupabasePrivateStore | null {
  if (process.env.MERCURY_AGENT_RECORD_STORE !== "supabase") return null;
  const store = SupabasePrivateStore.fromEnvironment();
  if (!store) throw new Error("Supabase agent record storage is enabled but not configured");
  return store;
}

function key(): Buffer {
  const path = keyPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Agent records key must be a private regular file");
  }
  const bytes = readFileSync(path);
  if (bytes.length !== 32) throw new Error("Agent records key must contain 32 bytes");
  return bytes;
}

function encrypt(value: unknown, aad: string): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url") };
}

function decrypt<T>(envelope: Envelope, aad: string): T {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final()]).toString("utf8")) as T;
}

function readSessions(): Journal {
  try {
    const journal = JSON.parse(readFileSync(sessionPath(), "utf8")) as Journal;
    if (journal.version !== 1 || !Array.isArray(journal.sessions)) throw new Error("Invalid agent session journal");
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sessions: [] };
    throw error;
  }
}

function saveSessions(journal: Journal): void {
  const path = sessionPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal), { mode: 0o600 });
  renameSync(temporary, path);
  mirrorCompanyJournal({ domain: "agent-sessions", journal, rowKeys: ["sessions"] });
}

function sessionId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Agent session ID must be a UUID v4");
  }
  return value.toLowerCase();
}

type Identity = { company: string; actor: string; access: AssistantAccess; grant: string | null };

export async function loadAgentSession(input: Identity & { id: unknown; now?: Date }): Promise<SessionData> {
  const id = sessionId(input.id);
  const store = database();
  const session = store ? await store.get<Session>(input.company, "operation.agent-session", id) :
    readSessions().sessions.find((item) => item.id === id);
  const now = (input.now ?? new Date()).getTime();
  if (!session || session.company !== input.company || session.actor !== input.actor ||
      session.role !== input.access.role || session.scope !== input.access.scope ||
      session.grant !== input.grant || now - Date.parse(session.updatedAt) >= SESSION_MS) {
    throw new Error("Agent session is unavailable for this wallet and active permission");
  }
  return decrypt<SessionData>(session.envelope, `${session.company}:${session.actor}:${session.id}`);
}

export async function saveAgentSession(input: Identity & { id?: unknown; data: SessionData; now?: Date }): Promise<string> {
  const id = input.id === undefined ? randomUUID() : sessionId(input.id);
  const now = input.now ?? new Date();
  if (input.id !== undefined) await loadAgentSession({ ...input, id, now });
  const answers = input.data.verifiedAnswers.slice(-4).map((value) => value.slice(0, 1_000));
  const data: SessionData = { requestAddress: input.data.requestAddress,
    payrollRunId: input.data.payrollRunId, verifiedAnswers: answers };
  const session: Session = { id, company: input.company, actor: input.actor,
    role: input.access.role, scope: input.access.scope, grant: input.grant,
    updatedAt: now.toISOString(), envelope: encrypt(data, `${input.company}:${input.actor}:${id}`) };
  const store = database();
  if (store) {
    await store.put({ companyId: input.company, domain: "operation.agent-session", recordId: id,
      payload: session, metadata: { kind: "agent-session" } });
  } else {
    const journal = readSessions();
    journal.sessions = journal.sessions.filter((item) => item.id !== id &&
      now.getTime() - Date.parse(item.updatedAt) < SESSION_MS);
    journal.sessions.push(session);
    saveSessions(journal);
  }
  return id;
}

export async function appendAgentAudit(input: Omit<AgentAuditEntry, "id" | "at">): Promise<void> {
  const entry: AgentAuditEntry = { ...input, id: randomUUID(), at: new Date().toISOString() };
  const serialized = JSON.stringify(entry);
  if (Buffer.byteLength(serialized) > 32_000) throw new Error("Agent audit event is too large");
  const store = database();
  if (store) {
    await store.put({ companyId: entry.company, domain: "operation.agent-audit", recordId: entry.id,
      payload: entry, metadata: { kind: "agent-audit", event: entry.event } });
    return;
  }
  const path = auditPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const line = JSON.stringify({ version: 1, company: input.company, actor: input.actor,
    envelope: encrypt(entry, `${input.company}:${input.actor}`) });
  appendFileSync(path, `${line}\n`, { mode: 0o600 });
  schedulePrivateAuditEvent({ company: entry.company, eventId: entry.id, eventType: "agent-tool", payload: entry });
}

export async function listAgentAudit(company: string, actor: string, grant: string | null,
  limit = 50): Promise<AgentAuditEntry[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid agent audit limit");
  const store = database();
  if (store) return (await store.list<AgentAuditEntry>(company, "operation.agent-audit", 500))
    .filter((entry) => entry.actor === actor && entry.grant === grant)
    .sort((left, right) => right.at.localeCompare(left.at)).slice(0, limit);
  let lines: string;
  try { lines = readFileSync(auditPath(), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return lines.trim().split("\n").filter(Boolean).slice(-5_000).map((line) =>
    JSON.parse(line) as { version: number; company: string; actor: string; envelope: Envelope })
    .filter((record) => record.version === 1 && record.company === company && record.actor === actor)
    .map((record) => decrypt<AgentAuditEntry>(record.envelope, `${company}:${actor}`))
    .filter((entry) => entry.grant === grant).slice(-limit);
}
