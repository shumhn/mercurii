"use client";

import React from "react";

export function Manifesto() {
  return (
    <section id="manifesto" className="py-28 sm:py-36 border-t border-b border-white/[0.08] relative bg-[#07070a]">
      <div className="max-w-5xl mx-auto px-6 text-center">
        <h2 className="text-2xl sm:text-4xl md:text-5xl font-medium tracking-tight text-zinc-100 leading-[1.35]">
          We empower onchain organizations to operate with true corporate confidentiality. Salaries
          stay private. Vendor payments stay protected. Autonomous AI agents operate within hardware
          enclaves — accelerating the new financial internet where value moves freely, instantly,
          and with absolute secrecy.
        </h2>

        <div className="mt-12 flex items-center justify-center gap-3">
          <span className="text-xs uppercase tracking-widest text-zinc-500 font-mono">
            Hardware-Enforced Privacy
          </span>
          <span className="text-zinc-700">•</span>
          <span className="text-xs uppercase tracking-widest text-emerald-400 font-mono">
            MagicBlock Ephemeral Rollup
          </span>
        </div>
      </div>
    </section>
  );
}
