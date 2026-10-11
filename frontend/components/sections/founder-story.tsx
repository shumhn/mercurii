"use client";

import { motion } from "framer-motion";

export function FounderStory() {
  return (
    <section className="border-b border-black/[0.06] bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="mx-auto max-w-5xl text-center"
        >
          <span className="mercury-section-kicker block text-[#0b44fe]">
            The problem
          </span>
          <h2 className="mercury-section-title mercury-section-title--statement mt-5 text-gray-950">
            Stablecoins move globally. <br className="hidden sm:block" />
            <span className="text-[#0b44fe]">Company finances should stay private.</span>
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
          className="mercury-section-copy mx-auto mt-14 grid max-w-5xl gap-x-16 gap-y-6 text-gray-600 md:grid-cols-2"
        >
          <p>
            A client overseas pays an agency in stablecoins. The funds arrive in minutes. The agency
            can pay its remote team, contractor, or vendor without waiting for bank hours.
          </p>
          <p>
            Then the founder sees the company&apos;s public wallet. Anyone who connects that address to
            the business can follow transfers and infer its balance, payroll patterns, vendor
            relationships, and cash flow.
          </p>
          <p>
            Inside the company, Finance needs to pay invoices, managers need to approve team
            expenses, and employees should see their own payment—not the whole company&apos;s finances.
          </p>
          <p className="border-l-2 border-[#0b44fe] pl-5 font-medium text-gray-950 md:self-start">
            A company should not have to choose between stablecoin speed, financial privacy, and
            controlled access for people and AI agents.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
