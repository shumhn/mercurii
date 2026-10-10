import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SupabasePrivateStore, decryptPrivateRecord, encryptPrivateRecord } from "../src/supabase-private-store.ts";

const COMPANY = "11111111111111111111111111111111";
const FOUNDER = "SysvarRent111111111111111111111111111111111";

test("encrypted records are bound to company, domain, and record ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "mercury-supabase-store-"));
  const old = process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE;
  process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE = join(dir, "key");
  try {
    const envelope = encryptPrivateRecord({ amountMicro: "1000000", recipient: FOUNDER }, COMPANY, "payment", "payment-1");
    assert.deepEqual(decryptPrivateRecord(envelope, COMPANY, "payment", "payment-1"), { amountMicro: "1000000", recipient: FOUNDER });
    assert.throws(() => decryptPrivateRecord(envelope, COMPANY, "payment", "payment-2"));
  } finally {
    if (old === undefined) delete process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE;
    else process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Supabase adapter sends only encrypted record payloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mercury-supabase-store-"));
  const old = process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE;
  process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE = join(dir, "key");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mocked = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("", { status: 201 });
  };
  try {
    const store = new SupabasePrivateStore({ url: "https://example.supabase.co", secret: "a".repeat(30), fetch: mocked as typeof fetch });
    await store.put({ companyId: COMPANY, domain: "payment", recordId: "payment-1", payload: { amountMicro: "1000000", recipient: FOUNDER }, metadata: { state: "prepared" } });
    assert.equal(calls.length, 1);
    const sent = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(sent.company_id, COMPANY);
    assert.equal(sent.metadata.state, "prepared");
    assert.equal(JSON.stringify(sent).includes("1000000"), false);
    assert.equal(JSON.stringify(sent).includes(FOUNDER), false);
    assert.equal(typeof sent.envelope.ciphertext, "string");
  } finally {
    if (old === undefined) delete process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE;
    else process.env.MERCURY_SUPABASE_RECORDS_KEY_FILE = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("app directory and sync indexes keep financial terms out of Supabase columns", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mocked = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("", { status: 201 });
  };
  const store = new SupabasePrivateStore({ url: "https://example.supabase.co", secret: "a".repeat(30), fetch: mocked as typeof fetch });
  await store.upsertCompanyMemberCache(COMPANY, [{
    walletAddress: FOUNDER, grantAddress: "Stake11111111111111111111111111111111111111",
    role: "manager", state: "active",
  }]);
  await store.upsertSyncCursor({ companyId: COMPANY, stream: "per-state", cursorValue: "slot-123",
    observedSlot: 123, state: "idle" });
  assert.equal(calls.length, 2);
  const member = JSON.parse(String(calls[0]!.init?.body));
  assert.equal(member[0].role_cache, "manager");
  assert.equal(member[0].membership_state, "active");
  assert.equal(JSON.stringify(member).includes("recipient"), false);
  assert.equal(JSON.stringify(member).includes("amount"), false);
  const cursor = JSON.parse(String(calls[1]!.init?.body));
  assert.equal(cursor.stream, "per-state");
  assert.equal(cursor.observed_slot, 123);
});
