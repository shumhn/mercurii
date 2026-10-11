"use client";

import React from "react";
import { Check, X, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Comparison() {
  const comparisonData = [
    {
      feature: "Company Balance Visibility",
      legacy: "Publicly visible to anyone on Solscan/SolanaFM",
      mercury: "Encrypted inside MagicBlock TEE enclave",
      legacySafe: false,
    },
    {
      feature: "Payroll & Compensation Confidentiality",
      legacy: "Leaked to public, competitors & team members",
      mercury: "Client-side AES-256-GCM encrypted rosters",
      legacySafe: false,
    },
    {
      feature: "AI Agent Spending Limits",
      legacy: "Full key access or cumbersome manual multisig",
      mercury: "Isolated onchain float with hard per-payment caps",
      legacySafe: false,
    },
    {
      feature: "Granular Hierarchical Roles",
      legacy: "Binary M-of-N multisig signers",
      mercury: "Founder → Finance → Branch Manager delegation",
      legacySafe: false,
    },
    {
      feature: "Tax & Compliance Auditing",
      legacy: "Requires revealing entire public transaction trail",
      mercury: "Temporary single-use zero-knowledge audit links",
      legacySafe: false,
    },
  ];

  return (
    <section className="py-20 relative max-w-5xl mx-auto px-4">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <Badge variant="outline" className="mb-3">
          Why Privacy Matters
        </Badge>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-white">
          Traditional Onchain Multisig vs. Mercurii
        </h2>
        <p className="mt-3 text-sm sm:text-base text-zinc-400">
          Why the fastest-growing Web3 startups and AI companies choose confidential treasury
          infrastructure.
        </p>
      </div>

      <div className="rounded-3xl glass-panel border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] bg-zinc-950/40 text-xs">
                <th className="p-4 sm:p-5 font-semibold text-zinc-400">Feature</th>
                <th className="p-4 sm:p-5 font-semibold text-zinc-400 w-1/3">
                  <div className="flex items-center gap-1.5 text-zinc-400">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    <span>Traditional Public Multisig</span>
                  </div>
                </th>
                <th className="p-4 sm:p-5 font-semibold text-emerald-400 w-1/3 bg-emerald-500/[0.04]">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Mercurii Protocol</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-xs sm:text-sm">
              {comparisonData.map((row, idx) => (
                <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                  <td className="p-4 sm:p-5 font-medium text-white">{row.feature}</td>
                  <td className="p-4 sm:p-5 text-zinc-400">
                    <div className="flex items-start gap-2">
                      <X className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{row.legacy}</span>
                    </div>
                  </td>
                  <td className="p-4 sm:p-5 text-emerald-300 bg-emerald-500/[0.02]">
                    <div className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="font-medium">{row.mercury}</span>
                    </div>
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
