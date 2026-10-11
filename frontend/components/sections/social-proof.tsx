"use client";

import Image from "next/image";
import { motion } from "framer-motion";

const partners = [
  {
    name: "Solana",
    mark: (
      <Image
        src="/brands/solana-mark.svg"
        alt="Solana"
        width={101}
        height={88}
        className="h-6 w-auto sm:h-7"
      />
    ),
    labelClassName: "text-[#5c3bcf]",
    className: "gap-3",
  },
  {
    name: "MagicBlock",
    mark: (
      <span className="flex h-10 w-[166px] items-center justify-center rounded-xl bg-[#1c1428] px-3 shadow-[0_8px_20px_rgba(86,45,149,0.22)]">
        <Image
          src="/brands/magicblock-white.svg"
          alt="MagicBlock"
          width={162}
          height={32}
          className="h-5 w-auto"
        />
      </span>
    ),
    labelClassName: "sr-only",
    className: "",
  },
  {
    name: "Circle USDC",
    mark: (
      <Image
        src="/brands/usdc-token.svg"
        alt="USDC"
        width={96}
        height={96}
        className="size-7 sm:size-8"
      />
    ),
    labelClassName: "text-[#0B53BF]",
    className: "gap-3",
  },
];

export function SocialProof() {
  return (
    <section className="overflow-hidden border-y border-black/[0.06] bg-black/[0.015] py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="mx-auto max-w-7xl px-6 text-center"
      >
        <p className="mb-8 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Built on Solana, MagicBlock Private Ephemeral Rollups, and Circle USDC
        </p>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          transition={{ staggerChildren: 0.08 }}
          className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 sm:gap-x-14"
        >
          {partners.map(({ name, mark, labelClassName, className }) => (
            <motion.div
              key={name}
              variants={{
                hidden: { opacity: 0, y: 14, scale: 0.95 },
                visible: {
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  transition: { duration: 0.5, ease: "easeOut" },
                },
              }}
              whileHover={{ scale: 1.06, y: -2 }}
              className={`flex items-center font-semibold tracking-tight ${className}`}
            >
              {mark}
              <span className={`text-sm sm:text-base ${labelClassName}`}>{name}</span>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}
