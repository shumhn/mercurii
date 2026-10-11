"use client";

import React from "react";
import {
  Users,
  ShieldCheck,
  Bot,
  FileCheck2,
  Lock,
  ArrowRight,
  Sparkles,
  Zap,
  KeyRound,
  FileSpreadsheet,
  CheckCircle,
} from "lucide-react";
import { BorderBeam } from "@/components/ui/border-beam";
import { Badge } from "@/components/ui/badge";

export function BentoFeatures() {
  return (
    <section id="features" className="py-24 relative max-w-5xl mx-auto px-4">
      {/* Section Header */}
      <div className="text-center max-w-2xl mx-auto mb-16">
        <Badge variant="success" className="mb-3">
          Core Capabilities
        </Badge>
        <h2 className="text-3xl sm:text-5xl font-semibold tracking-[-0.03em] text-white">
          Enterprise Treasury Rails. Zero Information Leakage.
        </h2>
        <p className="mt-4 text-base text-zinc-400">
          Everything an onchain company needs to manage cashflow, distribute payroll, and empower
          employees and AI workers without compromising operational secrecy.
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Confidential Payroll (Large Span 2 Cols) */}
        <div className="md:col-span-2 rounded-3xl p-7 glass-panel border border-white/10 relative overflow-hidden group hover:border-white/20 transition-all flex flex-col justify-between">
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                Live Devnet Proof: 9/9 Settled
              </span>
            </div>

            <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">
              Confidential Payroll Runs
            </h3>
            <p className="mt-2 text-sm text-zinc-400 max-w-lg leading-relaxed">
              Disburse salaries to up to 100 employees in one click. Rosters are encrypted
              client-side with AES-256-GCM — neither the backend nor public blockchain ever sees
              plaintext salaries or employee wallet linkages.
            </p>

            {/* Visual simulation inside card */}
            <div className="mt-6 p-4 rounded-2xl bg-zinc-950/70 border border-white/5 font-mono text-xs space-y-2">
              <div className="flex items-center justify-between text-zinc-400 pb-2 border-b border-white/5 text-[11px]">
                <span>Employee</span>
                <span>Amount (USDC)</span>
                <span>Status</span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-400">eng-lead.sol</span>
                <span className="text-emerald-400">8,500.00</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Executed
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-400">product-design.sol</span>
                <span className="text-emerald-400">6,200.00</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Executed
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-400">security-contractor.sol</span>
                <span className="text-emerald-400">4,000.00</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Executed
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-zinc-500">
            <span>Chunked approvals (8 items per tx)</span>
            <span>Atomic SPL Token CPI</span>
          </div>
        </div>

        {/* Card 2: Autonomous AI Agent Float (Span 1 Col) */}
        <div className="rounded-3xl p-7 glass-panel border border-white/10 relative overflow-hidden group hover:border-white/20 transition-all flex flex-col justify-between">
          <div className="relative z-10">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-4">
              <Bot className="w-5 h-5" />
            </div>

            <h3 className="text-xl font-semibold text-white tracking-tight">
              AI Agent Sandboxes
            </h3>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
              Give autonomous agents spending powers without handing over company keys. Agents
              spend only from a bounded, separate float token account up to strict monthly caps.
            </p>

            <div className="mt-6 p-4 rounded-2xl bg-zinc-950/70 border border-white/5 space-y-2.5 text-xs">
              <div className="flex justify-between items-center text-zinc-400">
                <span>Float Limit</span>
                <span className="font-mono text-purple-300">500.00 USDC</span>
              </div>
              <div className="flex justify-between items-center text-zinc-400">
                <span>Allowed Target</span>
                <span className="font-mono text-zinc-300">Acme Cloud API</span>
              </div>
              <div className="flex justify-between items-center text-zinc-400">
                <span>Revocation</span>
                <span className="text-emerald-400 font-mono text-[10px]">Instant 1-Click</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/5 text-xs text-zinc-500">
            x402 Micropayments Protocol support
          </div>
        </div>

        {/* Card 3: Hierarchical Team Grants (Span 1 Col) */}
        <div className="rounded-3xl p-7 glass-panel border border-white/10 relative overflow-hidden group hover:border-white/20 transition-all flex flex-col justify-between">
          <div className="relative z-10">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4">
              <KeyRound className="w-5 h-5" />
            </div>

            <h3 className="text-xl font-semibold text-white tracking-tight">
              Hierarchical Team Grants
            </h3>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
              Programmatic governance with 4 grant roles: Founder, Finance, Branch Manager, and
              Requester. Finance can sub-delegate to Managers within narrower recipient whitelists.
            </p>

            <div className="mt-6 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-zinc-300">
                <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Branch-scoped bitpacking</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-300">
                <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Whitelisted vendor recipients</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-300">
                <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>30-day budget roll-over caps</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/5 text-xs text-zinc-500">
            Onchain Parent-Child integrity check
          </div>
        </div>

        {/* Card 4: Selective Compliance Audit Pass (Span 2 Cols) */}
        <div className="md:col-span-2 rounded-3xl p-7 glass-panel border border-white/10 relative overflow-hidden group hover:border-white/20 transition-all flex flex-col justify-between">
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <FileCheck2 className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-mono text-zinc-400 bg-zinc-800/60 px-2.5 py-1 rounded-full border border-white/5">
                Zero-Knowledge Disclosure
              </span>
            </div>

            <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">
              Selective Compliance & Audit Passes
            </h3>
            <p className="mt-2 text-sm text-zinc-400 max-w-lg leading-relaxed">
              Tax auditors and accountants need proof without seeing unrelated company secrets.
              Generate short-lived, encrypted audit bundles with single-use bearer tokens. Real-time
              access logging with instant revocation.
            </p>

            <div className="mt-6 p-4 rounded-2xl bg-zinc-950/70 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2 text-zinc-300">
                <Lock className="w-3.5 h-3.5 text-blue-400" />
                <span>audit-pass-7f9a2b...</span>
                <span className="text-zinc-500">•</span>
                <span className="text-emerald-400">Valid 48h</span>
              </div>
              <div className="text-zinc-400">Scrypt Key Derivation + AES-256-GCM</div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-zinc-500">
            <span>Granular payroll run selection</span>
            <span>Immutable access audit log</span>
          </div>
        </div>
      </div>
    </section>
  );
}
