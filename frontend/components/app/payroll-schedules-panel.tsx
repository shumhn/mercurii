"use client";

import { useState } from "react";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, DataState, inputClass, secondaryButtonClass } from "./mercurii-app";
import { openRoster, sealRoster, signSchedule, type EncryptedRoster } from "@/lib/mercurii-payroll-crypto";
import type { PayrollSchedule } from "@/lib/mercurii-client";

type RosterItem = { recipient: string; amountMicro: number; cadence?: "weekly" | "biweekly" | "monthly"; firstPayDate?: string };
type Preview = { items: RosterItem[]; errors: unknown[]; canCreateRun: boolean };
type ScheduleDetail = PayrollSchedule & { encryptedRoster: EncryptedRoster; revision: number; today: string;
  dueCycles: { payDate: string; state: string; launched: boolean }[] };
type StoredRoster = { requester: string; items: RosterItem[] };

function dueOn(item: RosterItem, payDate: string): boolean {
  if (!item.cadence || !item.firstPayDate || !/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return false;
  const start = Date.parse(`${item.firstPayDate}T00:00:00.000Z`);
  const current = Date.parse(`${payDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(current) || current < start) return false;
  if (item.cadence === "weekly" || item.cadence === "biweekly") {
    return (current - start) / 86_400_000 % (item.cadence === "weekly" ? 7 : 14) === 0;
  }
  const startDate = new Date(start); const date = new Date(current);
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return date.getUTCDate() === Math.min(startDate.getUTCDate(), monthEnd);
}

export function PayrollSchedulesPanel({ app }: { app: MercuriiController }) {
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [firstPayDate, setFirstPayDate] = useState("");
  const [cycleDate, setCycleDate] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Kathmandu");
  const [csv, setCsv] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const founder = app.session?.role === "founder";

  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Schedule action failed"); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!app.wallet || !app.session) throw new Error("Connect the Founder wallet");
    if (!name.trim() || (cadence !== "per_employee" && !firstPayDate)) throw new Error("Name and first pay date are required");
    const preview = await app.request<Preview>("/v1/payroll-runs/preview", { csvText: csv });
    if (!preview.canCreateRun || preview.errors.length || !preview.items.length) throw new Error("Resolve roster validation errors first");
    if (cadence === "per_employee" && preview.items.some((item) => !item.cadence || !item.firstPayDate)) {
      throw new Error("Individual schedules need cadence and first_pay_date columns for every employee");
    }
    const scheduleDate = cadence === "per_employee"
      ? firstPayDate || preview.items.map((item) => item.firstPayDate!).sort()[0]!
      : firstPayDate;
    const roster: StoredRoster = { requester: app.session.address,
      items: preview.items.map(({ recipient, amountMicro, cadence: employeeCadence, firstPayDate: employeeDate }) =>
        ({ recipient, amountMicro, ...(cadence === "per_employee" ? { cadence: employeeCadence, firstPayDate: employeeDate } : {}) })) };
    const encryptedRoster = await sealRoster(roster, passphrase);
    const body = { actor: app.session.address, scheduleId: crypto.randomUUID(), name: name.trim(),
      cadence, firstPayDate: scheduleDate, timeZone, encryptedRoster };
    const signed = await signSchedule(app.wallet, "create", app.session.company, body);
    const result = await app.request<PayrollSchedule>("/v1/payroll-schedules", signed);
    setCsv(""); setPassphrase(""); setName("");
    setMessage(`Schedule ${result.name} created. Save the passphrase securely; it is needed to launch a cycle.`);
    await app.refresh();
  }

  async function toggle(schedule: PayrollSchedule) {
    if (!app.wallet || !app.session) throw new Error("Connect the Founder wallet");
    const detail = await app.request<ScheduleDetail>(`/v1/payroll-schedules/${schedule.scheduleId}`);
    const body = { actor: app.session.address, scheduleId: schedule.scheduleId,
      expectedRevision: detail.revision, paused: !detail.paused };
    await app.request(`/v1/payroll-schedules/${schedule.scheduleId}`,
      await signSchedule(app.wallet, "update", app.session.company, body), "PATCH");
    setMessage(detail.paused ? "Schedule resumed" : "Schedule paused"); await app.refresh();
  }

  async function launch(schedule: PayrollSchedule, payDate: string) {
    if (!app.wallet || !app.session) throw new Error("Connect the Founder wallet");
    if (!passphrase) throw new Error("Enter the roster passphrase to launch this cycle");
    const detail = await app.request<ScheduleDetail>(`/v1/payroll-schedules/${schedule.scheduleId}`);
    const roster = await openRoster(detail.encryptedRoster, passphrase) as StoredRoster;
    if (roster.requester !== app.session.address || !Array.isArray(roster.items)) throw new Error("Roster does not match the Founder wallet");
    if (schedule.cadence === "per_employee" && payDate > detail.today) {
      throw new Error("Choose today or a past local pay date");
    }
    const dueItems = schedule.cadence === "per_employee" ? roster.items.filter((item) => dueOn(item, payDate)) : roster.items;
    if (!dueItems.length) throw new Error("No employees are due on that date");
    const readiness = await app.request<{ canCreateRun: boolean; note: string }>("/v1/payroll-runs/readiness", { items: dueItems });
    if (!readiness.canCreateRun) throw new Error(`Payroll is not ready: ${readiness.note}`);
    const body = { actor: app.session.address, requester: app.session.address,
      scheduleId: schedule.scheduleId, payDate, rosterRevision: detail.rosterRevision, items: dueItems };
    const result = await app.request<{ runId: string; items: unknown[] }>(`/v1/payroll-schedules/${schedule.scheduleId}/launch`,
      await signSchedule(app.wallet, "launch", app.session.company, body));
    setPassphrase(""); setMessage(`Cycle ${payDate} launched: ${result.items.length} private payment requests. Continue each request in Payments.`);
    await app.refresh();
  }

  return <section className={`${cardClass} p-5 sm:p-7`}>
    <h2 className="text-xl font-semibold">Payroll schedules</h2>
    <p className="mt-2 text-sm leading-6 text-app-muted">The roster is encrypted in this browser before storage. A Founder wallet signature binds each schedule and launch to its exact terms.</p>
    {founder && <div className="mt-5 max-w-md rounded-xl border border-app-line bg-app-canvas p-4">
      <label className="block text-sm font-semibold">Roster passphrase<input className={`${inputClass} mt-2`} type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} /></label>
      <p className="mt-2 text-xs leading-5 text-app-muted">Enter it to create a schedule or launch a due cycle. It stays in this tab and cannot be recovered by the backend.</p>
    </div>}
    <div className="mt-5"><DataState resource={app.payrollSchedules} empty="No recurring schedule configured." retry={app.refresh}>{(schedules) => <div className="divide-y divide-app-line">{schedules.map((schedule) => <div key={schedule.scheduleId} className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{schedule.name}</p><p className="mt-1 text-sm text-app-muted capitalize">{schedule.cadence.replaceAll("_", " ")} · {schedule.paused ? "Paused" : `Next ${schedule.nextPayDate ?? schedule.firstPayDate}`} · {schedule.timeZone}</p></div>
      {founder && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(() => toggle(schedule))}>{schedule.paused ? "Resume" : "Pause"}</button>}</div>
      {founder && !schedule.paused && schedule.dueCycles?.filter((cycle) => !cycle.launched).map((cycle) => <button key={cycle.payDate} className={`${secondaryButtonClass} mt-3 mr-2`} disabled={busy} onClick={() => void action(() => launch(schedule, cycle.payDate))}>Launch {cycle.payDate} · {cycle.state}</button>)}
      {founder && !schedule.paused && schedule.cadence === "per_employee" && <div className="mt-3 flex flex-wrap gap-2"><label className="sr-only" htmlFor={`cycle-${schedule.scheduleId}`}>Individual pay date</label><input id={`cycle-${schedule.scheduleId}`} className={`${inputClass} max-w-44`} type="date" value={cycleDate} onChange={(event) => setCycleDate(event.target.value)} />
        <button className={secondaryButtonClass} disabled={busy || !cycleDate} onClick={() => void action(() => launch(schedule, cycleDate))}>Launch due employees</button></div>}
    </div>)}</div>}</DataState></div>
    {founder && <div className="mt-6 grid gap-4 border-t border-app-line pt-6 lg:grid-cols-2">
      <div className="space-y-4"><h3 className="font-semibold">Create a schedule</h3><label className="block text-sm">Name<input className={`${inputClass} mt-2`} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block text-sm">Cadence<select className={`${inputClass} mt-2`} value={cadence} onChange={(e) => setCadence(e.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option><option value="per_employee">Each employee&apos;s cadence</option></select></label>
        <label className="block text-sm">{cadence === "per_employee" ? "Schedule reference date (optional)" : "First pay date"}<input className={`${inputClass} mt-2`} type="date" value={firstPayDate} onChange={(e) => setFirstPayDate(e.target.value)} /></label>
        <label className="block text-sm">Time zone<input className={`${inputClass} mt-2`} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} /></label></div>
      <div className="space-y-4"><label className="block text-sm">Roster CSV <span className="text-app-muted">{cadence === "per_employee" ? "wallet,amount_usdc,name,cadence,first_pay_date" : "wallet,amount_usdc,name"}</span><textarea className={`${inputClass} mt-2 min-h-36 py-3 font-mono`} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} /></label>
        <button className={buttonClass} disabled={busy || !csv.trim()} onClick={() => void action(create)}>Validate, encrypt & sign schedule</button></div></div>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-4 rounded-xl bg-brand/5 p-4 text-sm text-brand">{message}</p>}
  </section>;
}
