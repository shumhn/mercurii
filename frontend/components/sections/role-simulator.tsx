"use client";

import React, { useState } from "react";
import {
  ShieldAlert,
  EyeOff,
  CheckCircle2,
  Lock,
  Unlock,
  Users,
  Bot,
  Building,
  Key,
  Clock,
  Sparkles,
} from "lucide-react";
import { BorderBeam } from "@/components/ui/border-beam";
import { Badge } from "@/components/ui/badge";

type RoleType = "outsider" | "founder" | "finance" | "agent";

export function RoleSimulator() {
  const [activeRole, setActiveRole] = useState<RoleType>("outsider");

  return (
    <section id="simulator" className="py-20 relative max-w-5xl mx-auto px-4">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto mb-10">
        <Badge variant="purple" className="mb-3">
          Interactive Privacy Playground
        </Badge>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-white">
          Experience Hardware-Enforced Privacy
        </h2>
        <p className="mt-3 text-sm sm:text-base text-zinc-400">
          Switch perspectives below to see how MagicBlock TEE enclaves shield sensitive corporate
          financials from public explorers while allowing authorized operations.
        </p>
      </div>

      {/* Role Switcher Tabs */}
      <div className="flex items-center justify-center gap-1.5 sm:gap-2 p-1.5 rounded-2xl glass-panel max-w-xl mx-auto mb-8 border-white/10">
        <button
          onClick={() => setActiveRole("outsider")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all ${
            activeRole === "outsider"
              ? "bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-sm"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
          }`}
        >
          <EyeOff className="w-3.5 h-3.5 text-rose-400" />
          <span>Public Explorer</span>
        </button>

        <button
          onClick={() => setActiveRole("founder")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all ${
            activeRole === "founder"
              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
          }`}
        >
          <Building className="w-3.5 h-3.5 text-emerald-400" />
          <span>Founder View</span>
        </button>

        <button
          onClick={() => setActiveRole("finance")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all ${
            activeRole === "finance"
              ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
          }`}
        >
          <Key className="w-3.5 h-3.5 text-cyan-400" />
          <span>Finance Grant</span>
        </button>

        <button
          onClick={() => setActiveRole("agent")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all ${
            activeRole === "agent"
              ? "bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
          }`}
        >
          <Bot className="w-3.5 h-3.5 text-purple-400" />
          <span>Autonomous Agent</span>
        </button>
      </div>

      {/* Simulator Dashboard Display Box */}
      <div className="relative rounded-3xl p-6 sm:p-8 glass-panel border border-white/10 shadow-2xl overflow-hidden transition-all duration-300">
        <BorderBeam
          size={180}
          duration={activeRole === "outsider" ? 20 : 10}
          colorFrom={
            activeRole === "outsider"
              ? "#f43f5e"
              : activeRole === "founder"
              ? "#10b981"
              : activeRole === "finance"
              ? "#06b6d4"
              : "#a855f7"
          }
          colorTo="#3b82f6"
        />

        {/* Top Status Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-white/[0.08] gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${
                activeRole === "outsider"
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                  : activeRole === "founder"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : activeRole === "finance"
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : "bg-purple-500/10 border-purple-500/30 text-purple-400"
              }`}
            >
              {activeRole === "outsider" && <ShieldAlert className="w-5 h-5" />}
              {activeRole === "founder" && <Building className="w-5 h-5" />}
              {activeRole === "finance" && <Key className="w-5 h-5" />}
              {activeRole === "agent" && <Bot className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-base tracking-tight">
                  {activeRole === "outsider" && "Solana Base RPC / Public Block Explorer"}
                  {activeRole === "founder" && "Acme Labs Treasury — Master Founder Enclave"}
                  {activeRole === "finance" && "Finance Officer — Scoped TeamGrant #1"}
                  {activeRole === "agent" && "Mercurii AI Worker — Isolated AgentPolicy Float"}
                </h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    activeRole === "outsider"
                      ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  }`}
                >
                  {activeRole === "outsider" ? "ACCESS DENIED" : "TEE AUTHENTICATED"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {activeRole === "outsider" &&
                  "External actor attempting to query MagicBlock TEE PER validator state via public RPC."}
                {activeRole === "founder" &&
                  "Root administrator with full company governance, payment approval, and grant revocation."}
                {activeRole === "finance" &&
                  "Restricted to pre-approved vendor list (max 16) and $10,000 monthly spending limit."}
                {activeRole === "agent" &&
                  "Autonomous worker with zero direct treasury access. Strictly bounded to $500 float."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center font-mono text-xs text-zinc-400 bg-zinc-900/80 px-3 py-1.5 rounded-xl border border-white/5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Slot: 509,146,140</span>
          </div>
        </div>

        {/* Dashboard Grid Content */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          {/* Card 1: Main Balance */}
          <div className="p-5 rounded-2xl glass-panel-subtle flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
                <span>Vault Balance (USDC)</span>
                {activeRole === "outsider" ? (
                  <Lock className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </div>
              {activeRole === "outsider" ? (
                <div className="py-2">
                  <span className="font-mono text-xl sm:text-2xl font-bold text-rose-400 tracking-wider">
                    ••••••••••••
                  </span>
                  <div className="mt-1 text-[11px] font-mono text-zinc-500 flex items-center gap-1">
                    <span>ERR_PERMISSION_DENIED (6000)</span>
                  </div>
                </div>
              ) : activeRole === "agent" ? (
                <div className="py-2">
                  <span className="font-mono text-xl sm:text-2xl font-bold text-purple-300">
                    500.00 USDC
                  </span>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    Main Treasury: <span className="text-zinc-500">Isolated</span>
                  </div>
                </div>
              ) : (
                <div className="py-2">
                  <span className="font-mono text-xl sm:text-2xl font-bold text-emerald-400">
                    $245,800.00
                  </span>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    Circle Devnet USDC (Verified)
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-white/5 text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Security Level</span>
              <span className="font-mono font-medium text-emerald-400">TEE Hardware PER</span>
            </div>
          </div>

          {/* Card 2: 30-Day Spending Budget */}
          <div className="p-5 rounded-2xl glass-panel-subtle flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
                <span>30-Day Budget Policy</span>
                <Clock className="w-3.5 h-3.5 text-zinc-400" />
              </div>
              {activeRole === "outsider" ? (
                <div className="py-2">
                  <span className="font-mono text-xl sm:text-2xl font-bold text-zinc-600">
                    HIDDEN_STATE
                  </span>
                  <div className="mt-1 text-[11px] font-mono text-zinc-500">
                    State Shell on Base: 0
                  </div>
                </div>
              ) : activeRole === "finance" ? (
                <div className="py-2">
                  <div className="flex items-baseline justify-between font-mono">
                    <span className="text-xl sm:text-2xl font-bold text-cyan-300">$1,000.00</span>
                    <span className="text-xs text-zinc-400">/ $10,000 Cap</span>
                  </div>
                  <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-cyan-400 h-full w-[10%]" />
                  </div>
                </div>
              ) : activeRole === "agent" ? (
                <div className="py-2">
                  <div className="flex items-baseline justify-between font-mono">
                    <span className="text-xl sm:text-2xl font-bold text-purple-300">$24.50</span>
                    <span className="text-xs text-zinc-400">/ $500 Period Cap</span>
                  </div>
                  <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-purple-400 h-full w-[5%]" />
                  </div>
                </div>
              ) : (
                <div className="py-2">
                  <div className="flex items-baseline justify-between font-mono">
                    <span className="text-xl sm:text-2xl font-bold text-emerald-400">$14,250.00</span>
                    <span className="text-xs text-zinc-400">/ $100,000 Cap</span>
                  </div>
                  <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-emerald-400 h-full w-[14.25%]" />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-white/5 text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Enforced By</span>
              <span className="font-mono font-medium text-zinc-300">Smart Contract CPI</span>
            </div>
          </div>

          {/* Card 3: Recent Activity / Roster */}
          <div className="p-5 rounded-2xl glass-panel-subtle flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
                <span>Recent Team Activity</span>
                <Users className="w-3.5 h-3.5 text-zinc-400" />
              </div>
              {activeRole === "outsider" ? (
                <div className="py-2 space-y-1.5">
                  <div className="h-5 bg-zinc-800/60 rounded animate-pulse" />
                  <div className="h-5 bg-zinc-800/40 rounded animate-pulse" />
                  <div className="h-5 bg-zinc-800/30 rounded animate-pulse" />
                  <div className="text-[11px] font-mono text-rose-400 mt-2">
                    0 Public Transaction Logs
                  </div>
                </div>
              ) : (
                <div className="py-1 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Payroll Batch #8461
                    </span>
                    <span className="font-mono text-zinc-400">9/9 Settled</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Acme Cloud Invoice
                    </span>
                    <span className="font-mono text-zinc-400">Approved</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      x402 Micro-Spend
                    </span>
                    <span className="font-mono text-zinc-400">0.01 USDC</span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-white/5 text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Auditor Pass</span>
              <span className="font-mono text-zinc-300">AES-256 Encrypted</span>
            </div>
          </div>
        </div>

        {/* Bottom Explainer Banner */}
        <div className="mt-6 p-4 rounded-xl bg-zinc-950/60 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-zinc-300">
              {activeRole === "outsider" &&
                "Public blockchain observers only see empty account shells. No recipient or amount is ever committed to public state."}
              {activeRole === "founder" &&
                "Founder holds master capabilities: directly executing payments, revoking team grants, and clawing back agent floats."}
              {activeRole === "finance" &&
                "Finance members can only approve/execute to whitelisted recipients within per-payment and 30-day limits."}
              {activeRole === "agent" &&
                "Autonomous agents operate in a hardware sandbox. Even if the agent key is leaked, the company vault remains untouched."}
            </span>
          </div>
          <div className="font-mono text-[11px] text-emerald-400 whitespace-nowrap">
            Zero-Knowledge State
          </div>
        </div>
      </div>
    </section>
  );
}
