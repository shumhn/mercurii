import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendAgentAudit, listAgentAudit, loadAgentSession,
  saveAgentSession } from "../src/agent-records.ts";

test("agent session is encrypted and bound to wallet, grant, role and expiry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-agent-records-"));
  process.env.MERCURY_AGENT_RECORDS_KEY_FILE = join(directory, "key");
  process.env.MERCURY_AGENT_SESSIONS_JOURNAL = join(directory, "sessions.json");
  try {
    const identity = { company: "company-1", actor: "actor-1",
      access: { actor: "actor-1", role: "finance" as const, scope: null }, grant: "grant-1" };
    const now = new Date("2026-10-10T00:00:00.000Z");
    const data = { requestAddress: "request-1", payrollRunId: null,
      verifiedAnswers: ["Private treasury balance 1.25 USDC"] };
    const id = await saveAgentSession({ ...identity, data, now });
    assert.equal(statSync(process.env.MERCURY_AGENT_RECORDS_KEY_FILE).mode & 0o077, 0);
    assert.doesNotMatch(readFileSync(process.env.MERCURY_AGENT_SESSIONS_JOURNAL, "utf8"), /1\.25 USDC/);
    assert.deepEqual(await loadAgentSession({ ...identity, id, now }), data);
    await assert.rejects(loadAgentSession({ ...identity, grant: "grant-2", id, now }), /unavailable/);
    await assert.rejects(loadAgentSession({ ...identity, access: { ...identity.access,
      role: "viewer" as const }, id, now }), /unavailable/);
    await assert.rejects(loadAgentSession({ ...identity, id,
      now: new Date("2026-10-11T00:00:00.000Z") }), /unavailable/);
  } finally {
    delete process.env.MERCURY_AGENT_RECORDS_KEY_FILE;
    delete process.env.MERCURY_AGENT_SESSIONS_JOURNAL;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("agent audit encrypts tool facts and filters by active grant", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-agent-audit-"));
  process.env.MERCURY_AGENT_RECORDS_KEY_FILE = join(directory, "key");
  process.env.MERCURY_AGENT_AUDIT_JOURNAL = join(directory, "audit.jsonl");
  try {
    await appendAgentAudit({ company: "company-1", actor: "actor-1", grant: "grant-1",
      event: "tool", tool: "get_treasury_snapshot",
      details: { result: "Private treasury balance 1.25 USDC" } });
    assert.doesNotMatch(readFileSync(process.env.MERCURY_AGENT_AUDIT_JOURNAL, "utf8"), /1\.25 USDC/);
    assert.equal((await listAgentAudit("company-1", "actor-1", "grant-1"))[0]?.tool, "get_treasury_snapshot");
    assert.deepEqual(await listAgentAudit("company-1", "actor-1", "grant-2"), []);
    assert.deepEqual(await listAgentAudit("company-1", "actor-2", "grant-1"), []);
  } finally {
    delete process.env.MERCURY_AGENT_RECORDS_KEY_FILE;
    delete process.env.MERCURY_AGENT_AUDIT_JOURNAL;
    rmSync(directory, { recursive: true, force: true });
  }
});
