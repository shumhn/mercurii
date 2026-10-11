"use client";

import { Bot, BriefcaseBusiness, Check, Landmark, UserRound, UsersRound } from "lucide-react";
import { motion } from "framer-motion";

const roles = [
  {
    number: "02",
    role: "Finance",
    title: "Pays within policy",
    detail: "Assigned payments and records, only for approved recipients and spending limits.",
    icon: BriefcaseBusiness,
  },
  {
    number: "03",
    role: "Manager",
    title: "Owns team requests",
    detail: "Prepares or approves work that belongs to their team or branch.",
    icon: UsersRound,
  },
  {
    number: "04",
    role: "Employee",
    title: "Sees their own payment",
    detail: "No treasury access and no visibility into other salaries.",
    icon: UserRound,
  },
  {
    number: "05",
    role: "AI agent",
    title: "Works inside a boundary",
    detail: "Prepares requests or uses only a separate, capped agent budget.",
    icon: Bot,
  },
];

export function TeamControl() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-12 lg:items-center lg:gap-16 lg:px-8">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="lg:col-span-5"
        >
          <span className="mercury-section-kicker block text-[#0b44fe]">
            Company controls
          </span>
          <h2 className="mercury-section-title mercury-section-title--team mt-4 text-gray-950">
            Founder stays in control. {" "}
            <span className="text-[#0b44fe]">Everyone else gets a precise scope.</span>
          </h2>
          <p className="mercury-section-copy mt-6 max-w-xl text-gray-600">
            Mercurii turns company roles into financial access. Every person and agent gets the
            permissions they need for their work, without a shared key or unrestricted balance.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
          className="lg:col-span-7"
        >
          <div className="rounded-3xl border border-black/[0.08] bg-[#f7f7f6] p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between px-1 pb-4">
              <p className="text-sm font-semibold text-gray-950">Company access map</p>
              <span className="rounded-full bg-[#0b44fe]/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-[#0b44fe]">
                Least privilege
              </span>
            </div>

            <div className="rounded-2xl bg-[#0b44fe] p-5 text-white sm:p-6">
              <div className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                  <Landmark className="size-5" />
                </span>
                <div>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-white/70">
                    01 · Founder
                  </p>
                  <h3 className="mt-1 text-lg font-semibold tracking-[-0.025em]">Full company control</h3>
                  <p className="mt-1 max-w-md text-sm leading-relaxed text-white/80">
                    Sets policy, manages access, approves payments, and sees the full operating
                    picture.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {roles.map((role) => {
                const Icon = role.icon;
                return (
                  <div key={role.role} className="rounded-2xl border border-black/[0.07] bg-white p-4 sm:p-5">
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0b44fe]/10 text-[#0b44fe]">
                        <Icon className="size-4" />
                      </span>
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0b44fe]">
                        {role.number} · {role.role}
                      </p>
                    </div>
                    <h3 className="mt-4 text-sm font-semibold text-gray-950">{role.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">{role.detail}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-black/[0.07] px-1 pt-4 text-sm text-gray-600">
              <span className="flex size-5 items-center justify-center rounded-full bg-[#0b44fe] text-white">
                <Check className="size-3 stroke-[3]" />
              </span>
              Access can be limited, changed, or revoked as the company changes.
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
