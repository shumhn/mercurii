"use client";

import React, { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface FAQItem {
  question: string;
  answer: string;
}

const faqList: FAQItem[] = [
  {
    question: "What can a company run through Mercurii?",
    answer:
      "Mercurii is a private company operating account for stablecoins. Your team can receive and hold USDC, manage invoices, run payroll, approve vendor payments, set team access, and reconcile each payment from request to settlement — without turning a shared public wallet into the company finance system.",
  },
  {
    question: "How does Mercurii keep company operations private?",
    answer:
      "Mercurii uses MagicBlock Private Ephemeral Rollups for permissioned operating state and MagicBlock Private Payments for private payment flows. Balances, payment details, and role-scoped records are available to the people authorized to operate them. This is confidential company finance, not an anonymity tool: public funding or settlement legs can still expose their own on-chain metadata.",
  },
  {
    question: "How does each person get the right level of access?",
    answer:
      "Company rules turn roles into precise financial access. Founders and Finance receive the scope required to run company operations; managers see their team requests; employees see their own payment. Mercurii does not hold a shared treasury key, and access can be changed or revoked as roles change.",
  },
  {
    question: "Can we run payroll and vendor payments in one place?",
    answer:
      "Yes. Finance can prepare payroll runs, pay contractors and vendors, and track every payment through its approval and settlement status. The same company policy can require the right signer, cap spending, and keep sensitive payment details limited to authorized roles.",
  },
  {
    question: "What can a Mercurii AI agent actually do?",
    answer:
      "An authorized agent can answer role-aware finance questions, read approved records, check an invoice against a registered payee and budget, and prepare a payment request for review. It helps a finance team move work forward without gaining unrestricted access to company funds or records.",
  },
  {
    question: "Can an AI agent pay for tools and APIs?",
    answer:
      "Yes, for Founder-approved x402 services. The agent uses a separate, isolated wallet with an approved destination, exact USDC quote, per-payment cap, period cap, and revocation controls. Treasury payments still require the proper human signer; an agent cannot spend from an unrestricted company balance.",
  },
  {
    question: "How does a payment move from request to settlement?",
    answer:
      "A payment is prepared with its payee and supporting record, checked against company policy, approved by the required signer, then paid privately and recorded with its settlement status. Finance can follow the same payment from request to approval, payment, and reconciliation without relying on spreadsheets or chat history.",
  },
];

export function FAQs() {
  // Product overview is open by default
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section id="faq" className="py-20 sm:py-28 max-w-7xl mx-auto px-6 lg:px-8 border-t border-black/[0.06]">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">

        {/* Left Column: FAQS Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="lg:col-span-4"
        >
          <h2 className="mercury-section-title sticky top-24 uppercase text-gray-950">
            FAQS
          </h2>
        </motion.div>

        {/* Right Column: Interactive Animated Accordion with Scroll Reveal */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.75, ease: "easeOut" }}
          className="lg:col-span-8 divide-y divide-black/[0.08] border-y border-black/[0.08]"
        >
          {faqList.map((faq, idx) => {
            const isOpen = openIndex === idx;

            return (
              <div
                key={idx}
                className={`transition-colors duration-200 ${
                  isOpen ? "bg-black/[0.015]" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className={`w-full py-6 sm:py-7 flex items-center justify-between text-left gap-6 group cursor-pointer ${
                    isOpen ? "border-l-[3.5px] border-l-[#0b44fe] pl-4 sm:pl-5" : "pl-1"
                  }`}
                  aria-expanded={isOpen}
                >
                  <span
                    className={`text-lg sm:text-xl font-medium tracking-tight transition-colors ${
                      isOpen
                        ? "text-gray-950 font-semibold"
                        : "text-gray-900 group-hover:text-[#0b44fe]"
                    }`}
                  >
                    {faq.question}
                  </span>

                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.25 }}
                    className="shrink-0 text-gray-500 group-hover:text-gray-950 transition-colors"
                  >
                    {isOpen ? (
                      <Minus className="w-5 h-5 stroke-[2]" />
                    ) : (
                      <Plus className="w-5 h-5 stroke-[2]" />
                    )}
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div
                        className={`pb-7 text-sm sm:text-base text-gray-600 leading-relaxed font-normal max-w-3xl ${
                          isOpen ? "pl-4 sm:pl-5" : "pl-1"
                        }`}
                      >
                        {faq.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>

      </div>
    </section>
  );
}
