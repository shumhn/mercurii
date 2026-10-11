"use client";

import React from "react";
import { motion } from "framer-motion";

interface PathStep {
  step: string;
  title: string;
  description: string;
}

const steps: PathStep[] = [
  {
    step: "01",
    title: "Open a private company account",
    description:
      "Set company policy, team access, and private operating state in one place. No shared keys required.",
  },
  {
    step: "02",
    title: "Receive and hold USDC privately",
    description:
      "Clients and partners fund the company. Balances and day-to-day operations are visible only to authorized roles.",
  },
  {
    step: "03",
    title: "Give people and agents a precise scope",
    description:
      "Founder, Finance, Managers, and employees get the access they need. Agents can read only their authorized records.",
  },
  {
    step: "04",
    title: "Pay privately, under policy",
    description:
      "Run payroll and vendor payments with approvals. Agents can pay approved x402 tools from a separate capped budget.",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.7,
      ease: "easeOut" as const,
    },
  },
};

export function IncorporationPath() {
  return (
    <section className="py-20 sm:py-28 max-w-7xl mx-auto px-6 lg:px-8">
      {/* Main Section Headline with Scroll Fade */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="max-w-4xl mb-12 sm:mb-16"
      >
        <h2 className="mercury-section-title text-gray-950">
          A clear path from
          <br />
          private stablecoin receipt to{" "}<span className="text-[#0b44fe]">company operations.</span>
        </h2>
      </motion.div>

      {/* 4-Step Pristine White Card Container with Staggered Entrance */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        className="rounded-2xl sm:rounded-3xl bg-white border border-black/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.03)] overflow-hidden"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-gray-100/90">
          {steps.map((item, idx) => (
            <motion.div
              key={idx}
              variants={cardVariants}
              whileHover={{ y: -6, backgroundColor: "#fafbff" }}
              transition={{ duration: 0.25 }}
              className="pt-10 sm:pt-12 pb-12 sm:pb-16 px-8 sm:px-10 flex flex-col justify-start transition-colors cursor-pointer group"
            >
              {/* Step Number: Soft Periwinkle Display with Hover Pop */}
              <span className="text-5xl sm:text-[3.25rem] font-light text-[#BDCCFF] group-hover:text-[#0b44fe] tracking-tight leading-none block select-none mb-8 sm:mb-10 transition-colors duration-300">
                {item.step}
              </span>

              {/* Step Title */}
              <h3 className="mercury-card-title mb-3.5 text-gray-950 transition-colors group-hover:text-[#0b44fe]">
                {item.title}
              </h3>

              {/* Step Description */}
              <p className="text-[14px] sm:text-[14.5px] text-[#475569] leading-[1.65] font-normal">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
