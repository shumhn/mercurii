"use client";

import React from "react";

export function Manifesto() {
  return (
    <section id="manifesto" className="relative bg-[#0038ff] text-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 py-24 sm:py-32">
        {/* Top row: wordmark + eyebrow, mirroring the pitch-deck vision slide */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-bold tracking-tight">mercurii</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            Private finance for internet businesses
          </span>
        </div>

        <h2 className="mt-14 sm:mt-20 max-w-5xl text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05]">
          Every onchain company deserves an operating account&mdash;not a public spreadsheet.
        </h2>

        <div className="mt-14 sm:mt-20 border-t border-white/25 pt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs uppercase tracking-widest text-white/70 font-mono">
            Hardware-Enforced Privacy
          </span>
          <span className="text-white/40">&bull;</span>
          <span className="text-xs uppercase tracking-widest text-white font-mono">
            MagicBlock Ephemeral Rollup
          </span>
        </div>
      </div>
    </section>
  );
}
