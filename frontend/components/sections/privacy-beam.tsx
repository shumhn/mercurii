"use client";

import React from "react";
import { Cpu, Lock, Database, CheckCircle2 } from "lucide-react";
import { BorderBeam } from "@/components/ui/border-beam";
import { Badge } from "@/components/ui/badge";

export function PrivacyBeam() {
  return (
    <section id="tee-architecture" className="py-20 relative max-w-5xl mx-auto px-4">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <Badge variant="purple" className="mb-3">
          Deep Tech Architecture
        </Badge>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-white">
          How MagicBlock TEE Rollups Protect You
        </h2>
        <p className="mt-3 text-sm sm:text-base text-zinc-400">
          A two-phase account lifecycle ensures zero confidential numbers ever touch the public
          Solana base ledger.
        </p>
      </div>

      <div className="relative rounded-3xl p-6 sm:p-10 glass-panel border border-white/10 overflow-hidden">
        <BorderBeam size={220} duration={16} colorFrom="#8b5cf6" colorTo="#10b981" />

        {/* 3 Step Flow Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
          {/* Step 1 */}
          <div className="p-6 rounded-2xl bg-zinc-950/60 border border-white/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-zinc-500">PHASE 01</span>
                <Database className="w-4 h-4 text-zinc-400" />
              </div>
              <h3 className="font-semibold text-white text-base">Public Shell on L1</h3>
              <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                Accounts originate as empty, uninitialized shells on Solana Base. Zero balances,
                zero confidential limits. Lamports pre-fund future TEE rent.
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-white/5 font-mono text-[11px] text-zinc-500">
              solana-base: empty_shell
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-6 rounded-2xl bg-zinc-950/60 border border-emerald-500/20 shadow-[0_0_24px_rgba(16,185,129,0.08)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-emerald-400">PHASE 02</span>
                <Cpu className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="font-semibold text-white text-base">TEE Delegation</h3>
              <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                Account authority is delegated to MagicBlock Private Ephemeral Rollup (PER) running
                inside hardware enclaves (AMD SEV-SNP / Intel SGX).
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-white/5 font-mono text-[11px] text-emerald-400">
              validator: MTEWGuqxUp...
            </div>
          </div>

          {/* Step 3 */}
          <div className="p-6 rounded-2xl bg-zinc-950/60 border border-white/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-purple-400">PHASE 03</span>
                <Lock className="w-4 h-4 text-purple-400" />
              </div>
              <h3 className="font-semibold text-white text-base">Confidential Execution</h3>
              <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                Only authenticated signers can read state. All transactions, balance updates, and
                logs are encrypted to unauthorized callers.
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-white/5 font-mono text-[11px] text-purple-400">
              ACL: TX_LOGS | TX_BALANCES
            </div>
          </div>
        </div>

        {/* Invariant guarantee callout */}
        <div className="mt-8 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-center justify-between text-xs text-zinc-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Zero-Custody Guarantee:</strong> The backend never holds treasury keys. Every
              payment execution is signed client-side by user wallets.
            </span>
          </div>
          <span className="font-mono text-emerald-400 hidden sm:inline">Non-Custodial</span>
        </div>
      </div>
    </section>
  );
}
