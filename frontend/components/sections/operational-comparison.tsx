"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { motion } from "framer-motion";

export function OperationalComparison() {
  const oldWayItems = [
    "A public address reveals your company balance and transfer history",
    "Finance cannot pay without access that is too broad or too weak",
    "Payroll, invoices, and expense approvals live across wallets and chat",
    "No clear record of what was paid, pending, or approved",
  ];

  const newWayItems = [
    "Sensitive company operations stay private from public explorers",
    "Roles, recipients, and caps are enforced by company policy",
    "Payroll and business payments are tracked through settlement",
    "AI agents work from isolated, tightly bounded budgets",
  ];

  return (
    <section id="story" className="py-16 sm:py-24 max-w-7xl mx-auto px-6 lg:px-8 relative overflow-hidden">

      {/* Main Headline with Scroll Reveal */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.75, ease: "easeOut" }}
        className="max-w-3xl mb-12 sm:mb-16"
      >
        <h2 className="mercury-section-title text-gray-950">
          From public wallet activity to{" "}
          <span className="text-[#0b44fe]">private company operations.</span>
        </h2>
      </motion.div>

      {/* Side-by-Side Comparison Card with Elevation Scroll Reveal */}
      <motion.div
        initial={{ opacity: 0, y: 36, scale: 0.98 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.85, ease: "easeOut" }}
        className="rounded-3xl overflow-hidden shadow-xl border border-black/[0.06] grid grid-cols-1 md:grid-cols-2"
      >
        {/* Left Half: THE OLD WAY */}
        <div className="bg-[#ebecee]/90 p-8 sm:p-12 lg:p-14 flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-400 block mb-8 sm:mb-10">
              THE OLD WAY
            </span>

            <ul className="space-y-6 sm:space-y-8">
              {oldWayItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-4">
                  <div className="w-5 h-5 rounded-full bg-gray-400/25 flex items-center justify-center shrink-0 mt-0.5">
                    <X className="w-3 h-3 text-gray-500 stroke-[3]" />
                  </div>
                  <span className="text-sm sm:text-base text-gray-600 font-medium leading-snug">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right Half: THE MERCURY WAY (Electric Blue) */}
        <div className="bg-[#0b44fe] p-8 sm:p-12 lg:p-14 text-white flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono font-semibold uppercase tracking-widest text-blue-200/75 block mb-8 sm:mb-10">
              THE MERCURY WAY
            </span>

            <ul className="space-y-6 sm:space-y-8">
              {newWayItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-4">
                  <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                    <Check className="w-3 h-3 text-[#0b44fe] stroke-[3.5]" />
                  </div>
                  <span className="text-sm sm:text-base text-white font-medium leading-snug">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
