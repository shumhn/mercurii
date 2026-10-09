import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { createAuditShare, listAuditShares, openAuditShare, revokeAuditShare } from "../src/compliance-audit.ts";

test("auditor links expose only an encrypted, expiring payroll snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-audit-"));
  const prior = process.env.MERCURY_COMPLIANCE_AUDIT_JOURNAL;
  const file = join(directory, "audits.json");
  process.env.MERCURY_COMPLIANCE_AUDIT_JOURNAL = file;
  try {
    const company = Keypair.generate().publicKey.toBase58();
    const employee = Keypair.generate().publicKey.toBase58();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const bundle = { version: 1 as const, company, generatedAt: new Date().toISOString(),
      period: { from: null, to: null }, payrollRuns: [{ runId: "run-1", recipient: employee, amountMicro: "1250000" }] };
    const created = createAuditShare({ company, label: "October review", expiresAt, bundle });
    assert.equal(created.token.length, 43);
    assert.equal(listAuditShares(company).length, 1);
    assert.equal(JSON.stringify(listAuditShares(company)).includes("1250000"), false);
    assert.deepEqual(openAuditShare(company, created.share.auditId, created.token).bundle, bundle);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const durable = readFileSync(file, "utf8");
    assert.equal(durable.includes(employee), false);
    assert.equal(durable.includes("1250000"), false);
    assert.throws(() => openAuditShare(company, created.share.auditId, "A".repeat(43)), /invalid, expired, or revoked/);
    revokeAuditShare(company, created.share.auditId);
    assert.throws(() => openAuditShare(company, created.share.auditId, created.token), /invalid, expired, or revoked/);
  } finally {
    if (prior === undefined) delete process.env.MERCURY_COMPLIANCE_AUDIT_JOURNAL;
    else process.env.MERCURY_COMPLIANCE_AUDIT_JOURNAL = prior;
    rmSync(directory, { recursive: true, force: true });
  }
});
