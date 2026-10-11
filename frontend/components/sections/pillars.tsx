"use client";

import React from "react";
import { ShieldCheck, Zap, Lock, Cpu, KeyRound } from "lucide-react";

export function Pillars() {
  const pillars = [
    {
      step: "01",
      title: "Zero Information Leakage",
      subtitle: "Hardware-Enforced Enclaves",
      description:
        "Sensitive accounts exist inside Intel TDX and AMD SEV-SNP confidential hardware enclaves. MagicBlock PER ACLs lock down transaction logs, internal messages, and balance mutations to authorized public keys only.",
      badge: "Intel TDX / AMD SEV",
    },
    {
      step: "02",
      title: "Sub-Second Settlement",
      subtitle: "<50ms End-to-End Latency",
      description:
        "Payments don't wait for base-layer consensus. Atomic SPL Token CPI transfers execute on the Private Ephemeral Rollup with sub-second finality, chunking up to 8 employee approvals per transaction.",
      badge: "Private Ephemeral Rollup",
    },
    {
      step: "03",
      title: "Zero Key Custody",
      subtitle: "100% Non-Custodial Builder",
      description:
        "The backend server never holds company treasury keys or private seeds. All transactions are constructed as unsigned base64 payloads and signed client-side by Founder, Finance, or Employee wallets.",
      badge: "Client-Side Signing",
    },
  ];

  return (
    <section id="pillars" className="py-28 relative max-w-7xl mx-auto px-6 border-t border-white/[0.08]">
      <div className="max-w-3xl mb-16">
        <span className="text-xs font-mono uppercase tracking-widest text-emerald-400">
          Core Architectural Guarantees
        </span>
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mt-3 leading-tight">
          Enterprise Security without Compromise.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {pillars.map((pillar, idx) => (
          <div
            key={idx}
            className="p-8 rounded-3xl bg-[#090a10] border border-white/[0.08] hover:border-white/20 transition-all flex flex-col justify-between group shadow-xl"
          >
            <div>
              <div className="flex items-center justify-between mb-8">
                <span className="font-mono text-3xl font-bold text-zinc-700 group-hover:text-emerald-400 transition-colors">
                  {pillar.step}
                </span>
                <span className="text-[10px] font-mono uppercase px-2.5 py-1 rounded-full bg-white/[0.04] text-zinc-300 border border-white/10">
                  {pillar.badge}
                </span>
              </div>

              <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {pillar.title}
              </h3>
              <div className="text-xs font-mono text-emerald-400 mt-1 mb-4">
                {pillar.subtitle}
              </div>

              <p className="text-sm text-zinc-400 leading-relaxed">
                {pillar.description}
              </p>
            </div>

            <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between text-[11px] font-mono text-zinc-500">
              <span>Mercurii Protocol</span>
              <span>Devnet Verified</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
