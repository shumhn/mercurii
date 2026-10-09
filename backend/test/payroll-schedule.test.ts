import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { openPayrollRoster, sealPayrollRoster } from "../src/payroll-roster-crypto.ts";
import { payrollScheduleMessage, verifyPayrollScheduleFounder } from "../src/payroll-schedule-auth.ts";
import { createPayrollSchedule, getPayrollSchedule, latestPayDate, launchScheduledPayroll,
  localDate, nextPayDate, payrollScheduleView, recentDueDates, updatePayrollSchedule } from "../src/payroll-schedule.ts";

test("pay dates follow the chosen local calendar day across weekly, biweekly, and short months", () => {
  const weekly = { cadence: "weekly" as const, firstPayDate: "2026-10-09" };
  const biweekly = { cadence: "biweekly" as const, firstPayDate: "2026-10-09" };
  const monthly = { cadence: "monthly" as const, firstPayDate: "2026-01-31" };
  assert.equal(localDate(new Date("2026-10-09T23:30:00Z"), "Asia/Kathmandu"), "2026-10-10");
  assert.equal(latestPayDate(weekly, "2026-10-22"), "2026-10-16");
  assert.equal(nextPayDate(weekly, "2026-10-22"), "2026-10-23");
  assert.equal(latestPayDate(biweekly, "2026-10-22"), "2026-10-09");
  assert.equal(nextPayDate(biweekly, "2026-10-22"), "2026-10-23");
  assert.equal(latestPayDate(monthly, "2026-02-28"), "2026-02-28");
  assert.equal(nextPayDate(monthly, "2026-02-28"), "2026-03-31");
  assert.deepEqual(recentDueDates(monthly, "2026-03-30"), ["2026-02-28", "2026-01-31"]);
  assert.equal(latestPayDate(monthly, "2026-01-30"), null);
});

test("scheduled payroll stores only ciphertext and reuses one run ID for a due cycle", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-payroll-schedule-"));
  const prior = [process.env.MERCURY_PAYROLL_SCHEDULE_JOURNAL,
    process.env.MERCURY_PAYROLL_JOURNAL, process.env.MERCURY_PAYMENT_FLOW_JOURNAL];
  const scheduleFile = join(directory, "schedules.json");
  const runFile = join(directory, "runs.json");
  const flowFile = join(directory, "flows.json");
  process.env.MERCURY_PAYROLL_SCHEDULE_JOURNAL = scheduleFile;
  process.env.MERCURY_PAYROLL_JOURNAL = runFile;
  process.env.MERCURY_PAYMENT_FLOW_JOURNAL = flowFile;
  try {
    const company = Keypair.generate().publicKey.toBase58();
    const requester = Keypair.generate().publicKey.toBase58();
    const recipient = Keypair.generate().publicKey.toBase58();
    const roster = { requester, items: [{ recipient, amountMicro: 1_250_000 }] };
    const passphrase = "private payroll recovery phrase";
    const encryptedRoster = sealPayrollRoster(roster, passphrase);
    assert.deepEqual(openPayrollRoster(encryptedRoster, passphrase), roster);
    assert.throws(() => openPayrollRoster(encryptedRoster, "different passphrase"));
    const scheduleId = randomUUID();
    const terms = { scheduleId, name: "October payroll", cadence: "weekly", firstPayDate: "2026-10-09",
      timeZone: "Asia/Kathmandu", encryptedRoster };
    const schedule = createPayrollSchedule(company, terms);
    assert.deepEqual(createPayrollSchedule(company, terms), schedule);
    assert.equal(statSync(scheduleFile).mode & 0o777, 0o600);
    assert.equal(readFileSync(scheduleFile, "utf8").includes(recipient), false);
    assert.equal(readFileSync(scheduleFile, "utf8").includes("1250000"), false);
    assert.deepEqual(getPayrollSchedule(company, scheduleId), schedule);
    assert.throws(() => getPayrollSchedule(Keypair.generate().publicKey.toBase58(), scheduleId), /Unknown/);
    const now = new Date("2026-10-09T04:00:00Z");
    assert.equal(payrollScheduleView(schedule, now).dueCycles[0]?.payDate, "2026-10-09");
    assert.equal(payrollScheduleView(schedule, now).dueCycles[0]?.state, "due");
    assert.equal(payrollScheduleView(schedule, new Date("2026-10-10T04:00:00Z")).dueCycles[0]?.state,
      "overdue");
    assert.throws(() => launchScheduledPayroll(company, scheduleId,
      { payDate: "2026-10-16", rosterRevision: 1, ...roster }, now), /not a due cycle/);
    const first = launchScheduledPayroll(company, scheduleId, { payDate: "2026-10-09", rosterRevision: 1, ...roster }, now);
    assert.equal(first.items.length, 1);
    assert.equal(launchScheduledPayroll(company, scheduleId, { payDate: "2026-10-09", rosterRevision: 1, ...roster }, now).runId,
      first.runId);
    assert.throws(() => launchScheduledPayroll(company, scheduleId, { payDate: "2026-10-09",
      rosterRevision: 1, requester, items: [{ recipient, amountMicro: 2_000_000 }] }, now), /different employees or amounts/);
    assert.equal(payrollScheduleView(schedule, now).dueCycles[0]?.launched, true);
    assert.equal(payrollScheduleView(schedule, now).dueCycles[0]?.state, "launched");
    assert.equal(readFileSync(runFile, "utf8").includes(recipient), false);
    assert.equal(readFileSync(flowFile, "utf8").includes(recipient), false);
    assert.equal(updatePayrollSchedule(company, scheduleId, { paused: true, expectedRevision: 0 }).revision, 1);
    assert.throws(() => updatePayrollSchedule(company, scheduleId,
      { paused: false, expectedRevision: 0 }), /reload/);
    assert.throws(() => launchScheduledPayroll(company, scheduleId,
      { payDate: "2026-10-09", rosterRevision: 1, ...roster }, now), /paused/);
    assert.throws(() => createPayrollSchedule(company, { ...terms, timeZone: "UTC" }), /different terms/);
  } finally {
    const keys = ["MERCURY_PAYROLL_SCHEDULE_JOURNAL", "MERCURY_PAYROLL_JOURNAL", "MERCURY_PAYMENT_FLOW_JOURNAL"] as const;
    keys.forEach((key, index) => {
      if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index];
    });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("per-employee schedules pay only people due on that pay date and bind roster revision", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-mixed-payroll-"));
  const prior = [process.env.MERCURY_PAYROLL_SCHEDULE_JOURNAL,
    process.env.MERCURY_PAYROLL_JOURNAL, process.env.MERCURY_PAYMENT_FLOW_JOURNAL];
  process.env.MERCURY_PAYROLL_SCHEDULE_JOURNAL = join(directory, "schedules.json");
  process.env.MERCURY_PAYROLL_JOURNAL = join(directory, "runs.json");
  process.env.MERCURY_PAYMENT_FLOW_JOURNAL = join(directory, "flows.json");
  try {
    const company = Keypair.generate().publicKey.toBase58();
    const requester = Keypair.generate().publicKey.toBase58();
    const weekly = Keypair.generate().publicKey.toBase58();
    const monthly = Keypair.generate().publicKey.toBase58();
    const schedule = createPayrollSchedule(company, { scheduleId: randomUUID(), name: "Flexible payroll",
      cadence: "per_employee", firstPayDate: "2026-10-01", timeZone: "Asia/Kathmandu",
      encryptedRoster: sealPayrollRoster({ encrypted: true }, "private payroll recovery phrase") });
    const now = new Date("2026-10-09T04:00:00Z");
    assert.equal(payrollScheduleView(schedule, now).perEmployeeCadence, true);
    assert.deepEqual(payrollScheduleView(schedule, now).dueCycles, []);
    const result = launchScheduledPayroll(company, schedule.scheduleId, { requester, payDate: "2026-10-09", rosterRevision: 1,
      items: [{ recipient: weekly, amountMicro: 1_000_000, cadence: "weekly", firstPayDate: "2026-10-02" }] }, now);
    assert.equal(result.items.length, 1);
    assert.throws(() => launchScheduledPayroll(company, schedule.scheduleId, { requester, payDate: "2026-10-09", rosterRevision: 1,
      items: [{ recipient: monthly, amountMicro: 1_000_000, cadence: "monthly", firstPayDate: "2026-10-01" }] }, now), /not due/);
    const revised = updatePayrollSchedule(company, schedule.scheduleId, { expectedRevision: 0,
      encryptedRoster: sealPayrollRoster({ encrypted: "new" }, "private payroll recovery phrase") });
    assert.equal(revised.rosterRevision, 2);
    assert.throws(() => launchScheduledPayroll(company, schedule.scheduleId, { requester, payDate: "2026-10-09", rosterRevision: 1,
      items: [{ recipient: weekly, amountMicro: 1_000_000, cadence: "weekly", firstPayDate: "2026-10-02" }] }, now), /Roster changed/);
  } finally {
    const keys = ["MERCURY_PAYROLL_SCHEDULE_JOURNAL", "MERCURY_PAYROLL_JOURNAL", "MERCURY_PAYMENT_FLOW_JOURNAL"] as const;
    keys.forEach((key, index) => { if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index]; });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schedule mutations require the Founder signature bound to company, schedule, and body", () => {
  const founder = Keypair.generate();
  const company = Keypair.generate().publicKey.toBase58();
  const scheduleId = randomUUID();
  const body = { actor: founder.publicKey.toBase58(), scheduleId, expectedRevision: 0, paused: true };
  const signature = bs58.encode(nacl.sign.detached(payrollScheduleMessage("update", company, body), founder.secretKey));
  const signed = { ...body, signature };
  assert.doesNotThrow(() => verifyPayrollScheduleFounder("update", company, body.actor, signed, scheduleId));
  assert.throws(() => verifyPayrollScheduleFounder("update", company, body.actor,
    { ...signed, paused: false }, scheduleId), /Invalid Founder schedule signature/);
  assert.throws(() => verifyPayrollScheduleFounder("update", company, body.actor,
    signed, randomUUID()), /Signed schedule ID/);
  assert.throws(() => verifyPayrollScheduleFounder("update", Keypair.generate().publicKey.toBase58(),
    body.actor, signed, scheduleId), /Invalid Founder schedule signature/);
});
