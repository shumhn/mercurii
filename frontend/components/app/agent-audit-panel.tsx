"use client";

import { useState } from "react";
import { signMessage } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass } from "./mercurii-app";

export function AgentAuditPanel({ app }: { app: MercuriiController }) {
  const [events, setEvents] = useState<Record<string, unknown>[] | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function load() {
    if (!app.wallet || !app.capabilities.financeAgent) return;
    setBusy(true); setError("");
    try {
      const actor = app.session!.address;
      const challenge = await app.request<{ challengeId: string; message: string }>(
        "/v1/assistant/challenge", { actor });
      const signature = await signMessage(app.wallet, challenge.message);
      const result = await app.request<{ events: Record<string, unknown>[] }>("/v1/agent/audit", {
        actor, challengeId: challenge.challengeId, signature,
        ...(app.session?.grantAddress ? { grant: app.session.grantAddress } : {}), limit: 50,
      });
      setEvents(result.events);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load agent activity"); }
    finally { setBusy(false); }
  }
  return <section className={`${cardClass} p-5 sm:p-7`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Agent activity</h2>
    <p className="mt-1 text-sm text-app-muted">Wallet-signed access to recent actions visible within this role.</p></div>
    <button className={buttonClass} disabled={busy || !app.capabilities.financeAgent} onClick={() => void load()}>Load activity</button></div>
    {!app.capabilities.financeAgent && <p className="mt-4 text-sm text-app-muted">Available when the backend enables the finance agent.</p>}
    {events && <div className="mt-5 divide-y divide-app-line">{events.length === 0 ? <p className="py-3 text-sm text-app-muted">No visible agent actions.</p> :
      events.map((event, index) => <div key={String(event.id ?? index)} className="py-3 text-sm"><p className="font-semibold">{String(event.event ?? event.action ?? "Agent action")}</p>
        <p className="mt-1 text-xs text-app-muted">{String(event.at ?? "Time unavailable")}{typeof event.tool === "string" ? ` · ${event.tool}` : ""}</p>
        {typeof event.details === "object" && event.details !== null &&
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-app-canvas p-3 text-xs">{JSON.stringify(event.details, null, 2)}</pre>}</div>)}</div>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </section>;
}
