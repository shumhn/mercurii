import assert from "node:assert/strict";
import test from "node:test";
import { configureSupabasePersistenceForTest, flushSupabasePersistence,
  mirrorCompanyJournal, schedulePrivateAuditEvent, supabasePersistenceStatus } from "../src/supabase-journal-persistence.ts";

const COMPANY_A = "11111111111111111111111111111111";
const COMPANY_B = "Stake11111111111111111111111111111111111111";

test("journal persistence writes isolated snapshots and encrypted operational rows", async () => {
  const old = process.env.MERCURY_SUPABASE_PERSISTENCE;
  process.env.MERCURY_SUPABASE_PERSISTENCE = "1";
  const writes: Array<Record<string, unknown>> = [];
  configureSupabasePersistenceForTest({
    put: async (input) => { writes.push(input as unknown as Record<string, unknown>); },
    appendAuditEvent: async () => undefined,
  });
  try {
    mirrorCompanyJournal({ domain: "payments", journal: { version: 1, payments: [
      { company: COMPANY_A, paymentId: "a", recipient: "private-a" },
      { company: COMPANY_B, paymentId: "b", recipient: "private-b" },
    ] }, rowKeys: ["payments"] });
    const status = await flushSupabasePersistence();
    assert.equal(status.lastFailure, null);
    assert.equal(writes.length, 4);
    const first = writes.find((item) => item.companyId === COMPANY_A && item.domain === "journal.payments")!;
    const second = writes.find((item) => item.companyId === COMPANY_B && item.domain === "journal.payments")!;
    assert.deepEqual(first.payload, { version: 1, payments: [{ company: COMPANY_A, paymentId: "a", recipient: "private-a" }] });
    assert.deepEqual(second.payload, { version: 1, payments: [{ company: COMPANY_B, paymentId: "b", recipient: "private-b" }] });
    assert.equal(first.domain, "journal.payments");
    assert.equal(first.recordId, "latest");
    const paymentA = writes.find((item) => item.companyId === COMPANY_A && item.domain === "operation.payment")!;
    const paymentB = writes.find((item) => item.companyId === COMPANY_B && item.domain === "operation.payment")!;
    assert.equal(paymentA.recordId, "a");
    assert.equal(paymentB.recordId, "b");
    assert.deepEqual(paymentA.payload, { company: COMPANY_A, paymentId: "a", recipient: "private-a" });
  } finally {
    configureSupabasePersistenceForTest(undefined);
    if (old === undefined) delete process.env.MERCURY_SUPABASE_PERSISTENCE;
    else process.env.MERCURY_SUPABASE_PERSISTENCE = old;
  }
});

test("persistence keeps application writes local when the mirror is disabled", async () => {
  const old = process.env.MERCURY_SUPABASE_PERSISTENCE;
  delete process.env.MERCURY_SUPABASE_PERSISTENCE;
  let calls = 0;
  configureSupabasePersistenceForTest({
    put: async () => { calls += 1; },
    appendAuditEvent: async () => { calls += 1; },
  });
  try {
    mirrorCompanyJournal({ domain: "payments", journal: { version: 1, payments: [{ company: COMPANY_A }] }, rowKeys: ["payments"] });
    schedulePrivateAuditEvent({ company: COMPANY_A, eventId: "event-1", eventType: "agent-tool", payload: { tool: "draft" } });
    await flushSupabasePersistence();
    assert.equal(calls, 0);
    assert.equal(supabasePersistenceStatus().enabled, false);
  } finally {
    configureSupabasePersistenceForTest(undefined);
    if (old === undefined) delete process.env.MERCURY_SUPABASE_PERSISTENCE;
    else process.env.MERCURY_SUPABASE_PERSISTENCE = old;
  }
});
