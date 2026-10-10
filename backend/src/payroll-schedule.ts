import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { asAddress } from "./magicblock.ts";
import { createPayrollRun, getPayrollRun } from "./payroll-run.ts";
import { paymentId } from "./payment-journal.ts";
import { type EncryptedPayrollRoster, validateEncryptedPayrollRoster } from "./payroll-roster-crypto.ts";
import { mirrorCompanyJournal } from "./supabase-journal-persistence.ts";

export type PayrollCadence = "weekly" | "biweekly" | "monthly" | "per_employee";
export type PayrollSchedule = {
  scheduleId: string; company: string; name: string; cadence: PayrollCadence;
  firstPayDate: string; timeZone: string; encryptedRoster: EncryptedPayrollRoster;
  paused: boolean; revision: number; rosterRevision: number; createdAt: string; updatedAt: string;
};
type Journal = { version: 1; schedules: PayrollSchedule[] };
const DEFAULT_PATH = new URL("../.state/payroll-schedules.json", import.meta.url).pathname;
const path = () => process.env.MERCURY_PAYROLL_SCHEDULE_JOURNAL ?? DEFAULT_PATH;
const MS_PER_DAY = 86_400_000;

function dateMs(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Pay date must be YYYY-MM-DD");
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error("Invalid pay date");
  return ms;
}

function formatDate(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
function addDays(date: string, days: number): string { return formatDate(dateMs(date) + days * MS_PER_DAY); }

function monthDate(firstPayDate: string, monthOffset: number): string {
  const first = new Date(dateMs(firstPayDate));
  const monthStart = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + monthOffset, 1));
  const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return formatDate(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(),
    Math.min(first.getUTCDate(), lastDay)));
}

export function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function latestPayDate(schedule: Pick<PayrollSchedule, "cadence" | "firstPayDate">, today: string): string | null {
  if (schedule.cadence === "per_employee") return null;
  const first = dateMs(schedule.firstPayDate);
  const current = dateMs(today);
  if (current < first) return null;
  if (schedule.cadence !== "monthly") {
    const interval = schedule.cadence === "weekly" ? 7 : 14;
    return addDays(schedule.firstPayDate, Math.floor((current - first) / MS_PER_DAY / interval) * interval);
  }
  const start = new Date(first);
  const end = new Date(current);
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (dateMs(monthDate(schedule.firstPayDate, months)) > current) months--;
  return months < 0 ? null : monthDate(schedule.firstPayDate, months);
}

export function nextPayDate(schedule: Pick<PayrollSchedule, "cadence" | "firstPayDate">, today: string): string {
  if (schedule.cadence === "per_employee") throw new Error("Per-employee schedules have no single next pay date");
  const latest = latestPayDate(schedule, today);
  if (!latest) return schedule.firstPayDate;
  if (schedule.cadence !== "monthly") return addDays(latest, schedule.cadence === "weekly" ? 7 : 14);
  const start = new Date(dateMs(schedule.firstPayDate));
  const end = new Date(dateMs(latest));
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  return monthDate(schedule.firstPayDate, months + 1);
}

export function recentDueDates(schedule: Pick<PayrollSchedule, "cadence" | "firstPayDate">,
  today: string, limit = 12): string[] {
  if (schedule.cadence === "per_employee") return [];
  const newest = latestPayDate(schedule, today);
  if (!newest) return [];
  const dates: string[] = [];
  let cursor = newest;
  for (let i = 0; i < limit && dateMs(cursor) >= dateMs(schedule.firstPayDate); i++) {
    dates.push(cursor);
    if (schedule.cadence === "monthly") {
      const first = new Date(dateMs(schedule.firstPayDate));
      const current = new Date(dateMs(cursor));
      const offset = (current.getUTCFullYear() - first.getUTCFullYear()) * 12 + current.getUTCMonth() - first.getUTCMonth();
      if (offset === 0) break;
      cursor = monthDate(schedule.firstPayDate, offset - 1);
    } else cursor = addDays(cursor, schedule.cadence === "weekly" ? -7 : -14);
  }
  return dates;
}

function readJournal(): Journal {
  try {
    const journal = JSON.parse(readFileSync(path(), "utf8")) as Journal;
    if (journal.version !== 1 || !Array.isArray(journal.schedules)) throw new Error("Invalid payroll schedule journal");
    for (const schedule of journal.schedules) {
      schedule.revision ??= 0;
      schedule.rosterRevision ??= 1;
    }
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, schedules: [] };
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const destination = path();
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, destination);
  mirrorCompanyJournal({ domain: "payroll-schedules", journal, rowKeys: ["schedules"] });
}

/** Hydrates the synchronous scheduler cache from encrypted durable records. */
export function hydratePayrollScheduleCache(schedules: PayrollSchedule[]): void {
  const journal = readJournal();
  let changed = false;
  for (const schedule of schedules) {
    const current = journal.schedules.find((item) => item.scheduleId === schedule.scheduleId);
    if (!current) { journal.schedules.push(schedule); changed = true; continue; }
    if (current.company !== schedule.company) throw new Error("Payroll schedule cache conflicts with durable schedule");
    if (JSON.stringify(current) !== JSON.stringify(schedule)) { Object.assign(current, schedule); changed = true; }
  }
  if (changed) saveJournal(journal);
}

export function createPayrollSchedule(companyInput: unknown, input: Record<string, unknown>): PayrollSchedule {
  const company = asAddress(companyInput, "company");
  const scheduleId = paymentId(input.scheduleId);
  if (typeof input.name !== "string" || input.name.trim().length < 1 || input.name.trim().length > 80) {
    throw new Error("Schedule name must be 1 to 80 characters");
  }
  if (input.cadence !== "weekly" && input.cadence !== "biweekly" && input.cadence !== "monthly" &&
      input.cadence !== "per_employee") {
    throw new Error("Cadence must be weekly, biweekly, monthly, or per_employee");
  }
  if (typeof input.firstPayDate !== "string") throw new Error("firstPayDate is required");
  dateMs(input.firstPayDate);
  if (typeof input.timeZone !== "string" || input.timeZone.length === 0 || input.timeZone.length > 80) {
    throw new Error("Invalid timeZone");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }); }
  catch { throw new Error("Invalid IANA timeZone"); }
  const encryptedRoster = validateEncryptedPayrollRoster(input.encryptedRoster);
  const journal = readJournal();
  const existing = journal.schedules.find((item) => item.scheduleId === scheduleId);
  if (existing) {
    if (existing.company !== company || existing.name !== input.name.trim() || existing.cadence !== input.cadence ||
        existing.firstPayDate !== input.firstPayDate || existing.timeZone !== input.timeZone ||
        JSON.stringify(existing.encryptedRoster) !== JSON.stringify(encryptedRoster)) {
      throw new Error("Schedule ID is already bound to different terms");
    }
    return existing;
  }
  const now = new Date().toISOString();
  const schedule: PayrollSchedule = { scheduleId, company, name: input.name.trim(), cadence: input.cadence,
    firstPayDate: input.firstPayDate, timeZone: input.timeZone, encryptedRoster,
    paused: false, revision: 0, rosterRevision: 1, createdAt: now, updatedAt: now };
  journal.schedules.push(schedule);
  saveJournal(journal);
  return schedule;
}

export function listPayrollSchedules(companyInput: unknown): PayrollSchedule[] {
  const company = asAddress(companyInput, "company");
  return readJournal().schedules.filter((item) => item.company === company);
}

export function getPayrollSchedule(companyInput: unknown, idInput: unknown): PayrollSchedule {
  const schedule = listPayrollSchedules(companyInput).find((item) => item.scheduleId === paymentId(idInput));
  if (!schedule) throw new Error("Unknown payroll schedule");
  return schedule;
}

export function updatePayrollSchedule(companyInput: unknown, idInput: unknown, input: Record<string, unknown>): PayrollSchedule {
  const company = asAddress(companyInput, "company");
  const scheduleId = paymentId(idInput);
  const journal = readJournal();
  const schedule = journal.schedules.find((item) => item.company === company && item.scheduleId === scheduleId);
  if (!schedule) throw new Error("Unknown payroll schedule");
  if (input.expectedRevision !== schedule.revision) throw new Error("Schedule was updated; reload before changing it");
  if (input.paused !== undefined) {
    if (typeof input.paused !== "boolean") throw new Error("paused must be boolean");
    schedule.paused = input.paused;
  }
  if (input.encryptedRoster !== undefined) {
    const roster = validateEncryptedPayrollRoster(input.encryptedRoster);
    if (JSON.stringify(roster) !== JSON.stringify(schedule.encryptedRoster)) {
      schedule.encryptedRoster = roster;
      schedule.rosterRevision++;
    }
  }
  if (input.paused === undefined && input.encryptedRoster === undefined) throw new Error("No schedule update supplied");
  schedule.revision++;
  schedule.updatedAt = new Date().toISOString();
  saveJournal(journal);
  return schedule;
}

export function scheduledRunId(companyInput: unknown, scheduleIdInput: unknown, payDate: string): string {
  const company = asAddress(companyInput, "company");
  const scheduleId = paymentId(scheduleIdInput);
  dateMs(payDate);
  const bytes = createHash("sha256").update(`mercury-payroll-cycle:${company}:${scheduleId}:${payDate}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function payrollScheduleView(schedule: PayrollSchedule, now = new Date()) {
  const today = localDate(now, schedule.timeZone);
  return { scheduleId: schedule.scheduleId, name: schedule.name, cadence: schedule.cadence,
    firstPayDate: schedule.firstPayDate, timeZone: schedule.timeZone, paused: schedule.paused,
    revision: schedule.revision, rosterRevision: schedule.rosterRevision,
    perEmployeeCadence: schedule.cadence === "per_employee", createdAt: schedule.createdAt, updatedAt: schedule.updatedAt, today,
    latestPayDate: latestPayDate(schedule, today),
    nextPayDate: schedule.cadence === "per_employee" ? null : nextPayDate(schedule, today),
    dueCycles: recentDueDates(schedule, today).map((payDate) => {
      const runId = scheduledRunId(schedule.company, schedule.scheduleId, payDate);
      let launched = false;
      try { getPayrollRun(runId, schedule.company); launched = true; }
      catch (error) {
        if (!/Unknown payroll run/.test(String(error))) throw error;
      }
      return { payDate, runId, launched,
        state: launched ? "launched" : payDate < today ? "overdue" : "due",
        status: launched ? `/v1/payroll-runs/${runId}` : null };
    }),
  };
}

export function launchScheduledPayroll(companyInput: unknown, idInput: unknown,
  input: Record<string, unknown>, now = new Date()) {
  const schedule = getPayrollSchedule(companyInput, idInput);
  if (schedule.paused) throw new Error("Payroll schedule is paused");
  if (typeof input.payDate !== "string") throw new Error("payDate is required");
  if (input.rosterRevision !== schedule.rosterRevision) {
    throw new Error("Roster changed; reload and launch the current roster revision");
  }
  const today = localDate(now, schedule.timeZone);
  if (dateMs(input.payDate) > dateMs(today) ||
      (schedule.cadence !== "per_employee" && latestPayDate(schedule, input.payDate) !== input.payDate)) {
    throw new Error("payDate is not a due cycle for this schedule");
  }
  const items = schedule.cadence === "per_employee"
    ? dueEmployeeItems(input.items, input.payDate)
    : input.items;
  const runId = scheduledRunId(schedule.company, schedule.scheduleId, input.payDate);
  const run = createPayrollRun(runId, schedule.company, { requester: input.requester, items,
    scheduleId: schedule.scheduleId, rosterRevision: schedule.rosterRevision, payDate: input.payDate });
  return { scheduleId: schedule.scheduleId, payDate: input.payDate, runId: run.runId,
    items: run.items.map((item) => ({ paymentId: item.paymentId, request: item.request,
      next: `/v1/payment-flows/${item.paymentId}/next` })),
    approve: `/v1/payroll-runs/${run.runId}/approve`, status: `/v1/payroll-runs/${run.runId}` };
}

function dueEmployeeItems(value: unknown, payDate: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("At least one due employee is required");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid employee at index ${index}`);
    const employee = item as Record<string, unknown>;
    if (employee.cadence !== "weekly" && employee.cadence !== "biweekly" && employee.cadence !== "monthly") {
      throw new Error(`Employee ${index + 1} needs weekly, biweekly, or monthly cadence`);
    }
    if (typeof employee.firstPayDate !== "string" || latestPayDate({ cadence: employee.cadence,
      firstPayDate: employee.firstPayDate }, payDate) !== payDate) {
      throw new Error(`Employee ${index + 1} is not due on ${payDate}`);
    }
    return { recipient: employee.recipient, amountMicro: employee.amountMicro };
  });
}
