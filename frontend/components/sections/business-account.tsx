"use client";

import {
  ArrowRight,
  Bot,
  Check,
  LockKeyhole,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { motion } from "framer-motion";

const operatingActions = [
  [Users, "Payroll", "Private salary run", "Ready"],
  [WalletCards, "Vendor payment", "Founder approval", "Review"],
  [Bot, "AI agent", "Separate capped budget", "Bounded"],
] as const;

export function BusinessAccount() {
  return (
    <section className="mx-auto max-w-7xl overflow-hidden px-6 py-16 sm:py-24 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.75, ease: "easeOut" }}
        className="max-w-5xl lg:max-w-none"
      >
        <h2 className="mercury-section-title">
          <span className="block text-gray-950 sm:whitespace-nowrap">
            One private account for <span className="text-[#0b44fe]">company money.</span>
          </span>
          <span className="mt-1 block max-w-6xl font-normal text-[#9ca3af] sm:mt-1.5">
            Payroll, vendor payments, and AI agents — governed by the same company controls.
          </span>
        </h2>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <motion.a
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.97 }}
            href="#signup"
            className="inline-flex items-center justify-center rounded-full bg-[#0b44fe] px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0038df] hover:shadow sm:text-base"
          >
            Get started for free
          </motion.a>
          <motion.a
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.97 }}
            href="#demo"
            className="inline-flex items-center justify-center rounded-full border border-gray-200/90 bg-white px-6 py-2.5 text-sm font-medium text-gray-950 shadow-xs transition-colors hover:bg-gray-50 sm:text-base"
          >
            Book a demo
          </motion.a>
        </div>
      </motion.div>

      <div className="mt-14 grid grid-cols-1 items-center gap-8 sm:mt-20 lg:grid-cols-12 lg:gap-8">
        <motion.div
          initial={{ opacity: 0, x: -28 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="space-y-6 lg:col-span-5"
        >
          <div>
            <span className="mercury-section-kicker mb-2.5 block text-[#0b44fe]">
              The foundation
            </span>
            <h3 className="mercury-card-title text-gray-950">
              The Mercurii Private Treasury
            </h3>
          </div>

          <p className="mercury-section-copy text-gray-600">
            Receive, hold, approve, pay, and reconcile company stablecoins from one private account.
            Sensitive balances, payment details, and records stay available only to the people who
            need them to run the business.
          </p>

          <ul className="space-y-3 pt-1 text-xs font-medium text-gray-700 sm:text-sm">
            <li className="flex items-center gap-2.5">
              <Check className="size-4 shrink-0 stroke-[2.5] text-emerald-600" />
              <span>Private company stablecoin balance</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Check className="size-4 shrink-0 stroke-[2.5] text-emerald-600" />
              <span>Controlled approvals and spending rules</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Check className="size-4 shrink-0 stroke-[2.5] text-emerald-600" />
              <span>Private payment records by role</span>
            </li>
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 24 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.85, ease: "easeOut" }}
          className="lg:col-span-7"
        >
          <div className="relative overflow-hidden rounded-3xl border border-blue-100 bg-[#f8faff] p-5 shadow-md sm:p-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                backgroundImage: "radial-gradient(rgba(11, 68, 254, 0.18) 1px, transparent 1px)",
                backgroundSize: "14px 14px",
              }}
            />

            <div className="relative">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 pb-5">
                <div>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#0b44fe]">
                    Private operating account
                  </p>
                  <p className="mt-1 text-sm text-gray-500">Company funds and rules in one place</p>
                </div>
                <span className="rounded-full border border-[#0b44fe]/15 bg-white px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#0b44fe]">
                  Private PER state
                </span>
              </div>

              <div className="grid items-stretch gap-4 py-6 md:grid-cols-[minmax(0,1fr)_30px_minmax(0,1.25fr)_30px_minmax(0,1fr)]">
                <div className="rounded-2xl border border-white bg-white/90 p-4 shadow-xs">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Receive
                  </p>
                  <div className="mt-4 flex size-9 items-center justify-center rounded-xl bg-[#0b44fe]/10 text-[#0b44fe]">
                    <ArrowRight className="size-4" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-gray-950">Client stablecoin payment</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    Funds enter the company account, ready for policy-controlled operations.
                  </p>
                </div>

                <div className="hidden items-center justify-center text-[#0b44fe] md:flex">
                  <ArrowRight className="size-5" />
                </div>

                <div className="rounded-2xl bg-[#0b44fe] p-5 text-white shadow-lg shadow-blue-500/20">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-white/15">
                      <LockKeyhole className="size-4" />
                    </span>
                    <span className="rounded-full bg-white/15 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-white/90">
                      Policy enforced
                    </span>
                  </div>
                  <p className="mt-5 text-sm font-semibold">Mercurii Private Treasury</p>
                  <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">•••,••• USDC</p>
                  <p className="mt-3 text-xs leading-relaxed text-white/75">
                    Balances, payment details, and operating records stay private to authorized roles.
                  </p>
                </div>

                <div className="hidden items-center justify-center text-[#0b44fe] md:flex">
                  <ArrowRight className="size-5" />
                </div>

                <div className="space-y-3">
                  {operatingActions.map(([Icon, title, description, status]) => (
                    <div key={title} className="rounded-xl border border-white bg-white/90 p-3.5 shadow-xs">
                      <div className="flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0b44fe]/10 text-[#0b44fe]">
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-gray-950">{title}</p>
                            <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#0b44fe]">
                              {status}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-blue-100 pt-4 font-mono text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-3.5 text-emerald-600" /> Private financial state
                </span>
                <span>•</span>
                <span>Team permissions</span>
                <span>•</span>
                <span>Settlement tracked</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
