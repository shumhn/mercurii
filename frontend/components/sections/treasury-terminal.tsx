"use client";

import React, { useState } from "react";
import {
  Search,
  Lock,
  Unlock,
  ExternalLink,
  CheckCircle2,
  Coins,
} from "lucide-react";

export function TreasuryTerminal() {
  const [activeTab, setActiveTab] = useState<"all" | "payroll" | "vendors" | "agent">("all");
  const [isOutsiderView, setIsOutsiderView] = useState(false);

  const transactions = [
    {
      id: "run-8461-01",
      purpose: "Payroll — Core Engineering Lead",
      category: "payroll",
      recipient: "eng-lead.sol (Encrypted ATA)",
      amount: "8,500.00",
      slot: "472,853,742",
      status: "Settled (Circle USDC)",
      hash: "49KrESZzxMigzPxJBRvEDAZCtpeBMAHiViEnBBoGjRsa2Hd2VxgWKxm2M7ZUPJK9YtUhqK9L93S2gZ4N2bUFQ55v",
      statusColor: "emerald",
    },
    {
      id: "run-8461-02",
      purpose: "Payroll — Product Design & Brand",
      category: "payroll",
      recipient: "design-core.sol (Encrypted ATA)",
      amount: "6,200.00",
      slot: "472,853,912",
      status: "Settled (Circle USDC)",
      hash: "ZaNscdVKCpRR13c9xMnexsQ1cDeq9QDy3JqEYjENkGNPw3kspYzzm6yLhZVUvi666di4iHoKen4up9wHjFDjggf",
      statusColor: "emerald",
    },
    {
      id: "inv-2026-09",
      purpose: "Cloud Infrastructure (Acme Cloud LLC)",
      category: "vendors",
      recipient: "Acme Cloud Vendor ATA",
      amount: "14,250.00",
      slot: "472,854,084",
      status: "Finance Grant Executed",
      hash: "2HoBWNrQBziB5Mpp7DDMNna8KaL8rZrW8pjc64btnuthZRKd5oYZqPfKTXmmDkHs9uEAPJdEy2jYwdv9hBtYBF67",
      statusColor: "cyan",
    },
    {
      id: "agt-flt-01",
      purpose: "Autonomous Agent SaaS Subscription",
      category: "agent",
      recipient: "Anthropic / API Provider",
      amount: "24.50",
      slot: "468,306,306",
      status: "Bounded Float Spend",
      hash: "36iv6JU7B2a2YSxVKpn9Z6bh4B7N7nHWmw7fPV1dBikTcc6MYTgYV21mn71C16bZD3Ebfq9UPhQqW7QjbLdXJvWz",
      statusColor: "purple",
    },
    {
      id: "run-8461-03",
      purpose: "Payroll — Smart Contract Auditor",
      category: "payroll",
      recipient: "audit-sec.sol (Encrypted ATA)",
      amount: "12,000.00",
      slot: "476,577,461",
      status: "Settled (Circle USDC)",
      hash: "56EJD3KHVV36bGZ4MAZDhiMjiJ9wL13HcH4ws78j5avg7HN4DweChg2tUsCUfbaPMjJMU6ybjx3WhnDWxiNTTP7A",
      statusColor: "emerald",
    },
  ];

  const filtered = transactions.filter((tx) => {
    if (activeTab === "all") return true;
    return tx.category === activeTab;
  });

  return (
    <section id="terminal" className="py-24 relative max-w-7xl mx-auto px-6">
      {/* Top Banner (Unwind.xyz Style) */}
      <div className="rounded-3xl texture-banner border border-white/[0.08] p-8 sm:p-14 relative overflow-hidden mb-12 shadow-2xl">
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/10 text-xs font-mono text-zinc-300 mb-6">
            <Coins className="w-3.5 h-3.5 text-emerald-400" />
            <span>Circle Devnet USDC Treasury Rails</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
            Execute any company payment,{" "}
            <span className="italic font-serif font-normal text-zinc-300">
              with zero leakage.
            </span>
          </h2>

          <p className="mt-4 text-base text-zinc-400 max-w-xl">
            Inspect real transactions settled on Solana Devnet through MagicBlock TEE rollups.
            Toggle the public view to see how outsiders are completely locked out.
          </p>
        </div>

        {/* Unwind-style Search Bar & Privacy Toggle */}
        <div className="mt-10 flex flex-col sm:flex-row items-stretch sm:items-center gap-4 relative z-10">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              readOnly
              value="Filter by verified Devnet USDC items..."
              className="w-full h-12 pl-11 pr-4 rounded-full bg-black/60 border border-white/10 text-xs sm:text-sm text-zinc-300 placeholder-zinc-500 font-mono focus:outline-none"
            />
          </div>

          {/* Privacy Toggle Switch Button */}
          <button
            onClick={() => setIsOutsiderView(!isOutsiderView)}
            className={`h-12 px-6 rounded-full font-semibold text-xs transition-all flex items-center justify-center gap-2 shrink-0 border ${
              isOutsiderView
                ? "bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_20px_rgba(244,63,94,0.3)]"
                : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
            }`}
          >
            {isOutsiderView ? (
              <>
                <Lock className="w-3.5 h-3.5 text-rose-400" />
                <span>Viewing as Public Explorer (Redacted)</span>
              </>
            ) : (
              <>
                <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Viewing as Founder (Authorized)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 3D Glossy Badge Filter Tabs (Unwind style) */}
      <div className="flex items-center gap-3 overflow-x-auto pb-4 mb-6">
        <button
          onClick={() => setActiveTab("all")}
          className={`glossy-badge px-5 py-2.5 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "all" ? "text-white border-white/30 bg-white/10" : "text-zinc-400"
          }`}
        >
          All Operations ({transactions.length})
        </button>

        <button
          onClick={() => setActiveTab("payroll")}
          className={`glossy-badge px-5 py-2.5 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "payroll" ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" : "text-zinc-400"
          }`}
        >
          Confidential Payroll (3)
        </button>

        <button
          onClick={() => setActiveTab("vendors")}
          className={`glossy-badge px-5 py-2.5 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "vendors" ? "text-cyan-300 border-cyan-500/40 bg-cyan-500/10" : "text-zinc-400"
          }`}
        >
          Vendor Invoices (1)
        </button>

        <button
          onClick={() => setActiveTab("agent")}
          className={`glossy-badge px-5 py-2.5 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "agent" ? "text-purple-300 border-purple-500/40 bg-purple-500/10" : "text-zinc-400"
          }`}
        >
          AI Agent Floats (1)
        </button>
      </div>

      {/* High-Density Ledger Table (Unwind.xyz Style) */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#08080d] overflow-hidden shadow-2xl relative">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] bg-zinc-950/60 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                <th className="py-4 px-6">Operation / Purpose</th>
                <th className="py-4 px-6">Confidential Recipient</th>
                <th className="py-4 px-6 text-right">Amount (USDC)</th>
                <th className="py-4 px-6">Execution Status</th>
                <th className="py-4 px-6 text-right">MagicBlock PER Proof</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-xs">
              {filtered.map((item, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-white/[0.03] transition-colors relative"
                >
                  {/* Column 1 */}
                  <td className="py-4 px-6">
                    <div className="font-medium text-white tracking-tight flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>{item.purpose}</span>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-500">ID: {item.id}</span>
                  </td>

                  {/* Column 2 */}
                  <td className="py-4 px-6 font-mono text-zinc-400">
                    {isOutsiderView ? (
                      <span className="text-zinc-600 font-semibold">[TEE_ENCLAVE_ENCRYPTED]</span>
                    ) : (
                      item.recipient
                    )}
                  </td>

                  {/* Column 3: Amount */}
                  <td className="py-4 px-6 text-right font-mono font-semibold">
                    {isOutsiderView ? (
                      <span className="text-rose-400 text-xs">••••••••</span>
                    ) : (
                      <span className="text-white text-sm">${item.amount}</span>
                    )}
                  </td>

                  {/* Column 4: Status */}
                  <td className="py-4 px-6">
                    <span
                      className={`inline-flex items-center gap-1.5 font-mono text-[10px] px-2.5 py-1 rounded-full border ${
                        item.statusColor === "emerald"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : item.statusColor === "cyan"
                          ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                          : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{item.status}</span>
                    </span>
                  </td>

                  {/* Column 5: Proof Link */}
                  <td className="py-4 px-6 text-right">
                    <a
                      href={`https://explorer.solana.com/tx/${item.hash}?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Finalized at MagicBlock slot ${item.slot}`}
                      className="inline-flex items-center gap-1 font-mono text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      <span>{item.hash.slice(0, 6)}...{item.hash.slice(-4)}</span>
                      <span className="text-zinc-600">· slot {item.slot}</span>
                      <ExternalLink className="w-3 h-3 text-zinc-500" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
