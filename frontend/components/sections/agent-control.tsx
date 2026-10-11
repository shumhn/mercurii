"use client";

import { Bot, Check, FileText, ShieldCheck, WalletCards } from "lucide-react";
import { motion } from "framer-motion";

const boundaries = [
  {
    label: "Role-aware answers",
    detail: "It answers from only the company records its role is allowed to read.",
  },
  {
    label: "Payment preparation",
    detail: "It checks the invoice, registered payee, and budget before creating a request.",
  },
  {
    label: "Treasury execution",
    detail: "It moves company money only through the required human approval and wallet signature.",
  },
  {
    label: "Bounded x402 payments",
    detail: "For approved tools and APIs, it pays from a separate capped agent wallet.",
  },
];

export function AgentControl() {
  return (
    <section className="border-y border-black/[0.06] bg-white py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-12 lg:items-center lg:gap-16 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="lg:col-span-5"
        >
          <span className="mercury-section-kicker block text-[#0b44fe]">
            AI company agents
          </span>
          <h2 className="mercury-section-title mercury-section-title--agent mt-4 text-gray-950">
            AI can understand, prepare, and pay. {" "}
            <span className="text-[#0b44fe]">Policy sets the limits.</span>
          </h2>
          <p className="mercury-section-copy mt-6 max-w-xl text-gray-600">
            Mercurii&apos;s agent answers finance questions from authorized records, checks invoices against
            registered payees and budgets, prepares company payments, and pays Founder-approved x402 tools
            and APIs from a separate agent balance.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {boundaries.map((boundary) => (
              <div
                key={boundary.label}
                className="rounded-2xl border border-black/[0.07] bg-[#f7f7f6] p-4"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-950">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0b44fe] text-white">
                    <Check className="size-3 stroke-[3]" />
                  </span>
                  {boundary.label}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{boundary.detail}</p>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
          className="lg:col-span-7"
        >
          <div className="overflow-hidden rounded-3xl border border-black/[0.08] bg-[#f5f5f4] shadow-sm">
            <div className="flex items-center justify-between border-b border-black/[0.08] bg-white px-6 py-5 sm:px-8">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[#0b44fe] text-white">
                  <Bot className="size-5" />
                </span>
                <div>
                  <p className="font-semibold text-gray-950">Mercurii Finance Agent</p>
                  <p className="text-sm text-gray-500">Authorized company assistant</p>
                </div>
              </div>
              <span className="rounded-full bg-[#0b44fe]/10 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-[#0b44fe]">
                Policy active
              </span>
            </div>

            <div className="space-y-3 p-5 sm:p-6">
              <div className="rounded-2xl border border-black/[0.06] bg-white p-5">
                <div className="flex items-start gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0b44fe]/10 text-[#0b44fe]">
                    <FileText className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-gray-950">1. Understand and prepare</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">
                      Answers role-aware questions, reads an authorized invoice, confirms the payee and
                      budget, then creates a company payment request.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["Authorized record", "Registered payee", "Budget checked"].map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-[#0b44fe]/8 px-2.5 py-1 text-[11px] font-semibold text-[#0b44fe]"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-black/[0.06] bg-white p-5">
                <div className="flex items-start gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0b44fe]/10 text-[#0b44fe]">
                    <ShieldCheck className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-gray-950">2. Company money goes through the right signer</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">
                      The Founder or authorized Finance signer reviews and signs the private treasury
                      payment. The agent never gets unrestricted treasury access.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-[#0b44fe] p-5 text-white">
                <div className="flex items-start gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
                    <WalletCards className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">3. Pay an x402 service from a separate agent budget</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/80">
                      The Founder assigns an allowlisted tool or API. The agent checks its 402 quote, then
                      pays the exact USDC amount from an isolated wallet within per-payment and period caps.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["Allowlisted service", "Exact USDC", "Receipt verified"].map((label) => (
                        <span key={label} className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white">
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
