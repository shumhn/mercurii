"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";

export function CtaBanner() {
  return (
    <section className="w-full bg-[#0b44fe] py-20 sm:py-28 lg:py-32 relative overflow-hidden">
      {/* Subtle Ambient Radial Lighting Accents that Float Organically */}
      <motion.div
        animate={{
          x: [0, 40, 0],
          y: [0, -30, 0],
          scale: [1, 1.15, 1],
        }}
        transition={{
          duration: 9,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute -top-40 -left-40 w-96 h-96 bg-blue-300/30 rounded-full blur-3xl pointer-events-none"
      />

      <motion.div
        animate={{
          x: [0, -40, 0],
          y: [0, 30, 0],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 11,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-400/35 rounded-full blur-3xl pointer-events-none"
      />

      {/* Full Screen Width Centered Content Container */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="max-w-5xl mx-auto px-6 lg:px-8 text-center relative z-10"
      >
        <h2 className="mercury-section-title text-white">
          Your company runs on stablecoins.
          <span className="block text-2xl sm:text-3xl lg:text-4xl font-medium text-white/90 mt-3 sm:mt-4">
            Its financial operations stay private.
          </span>
        </h2>

        {/* Spring Animated Action Buttons */}
        <div className="mt-10 sm:mt-12 flex flex-wrap items-center justify-center gap-4 sm:gap-5">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}>
            <Link
              href="#launch"
              className="inline-block px-9 py-4 rounded-full bg-black text-white hover:bg-gray-900 font-semibold text-base sm:text-lg transition-all shadow-xl"
            >
              Explore Mercurii
            </Link>
          </motion.div>

          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}>
            <Link
              href="#proof"
              className="inline-block px-9 py-4 rounded-full border border-white text-white hover:bg-white/10 font-semibold text-base sm:text-lg transition-all backdrop-blur-xs"
            >
              Verify the live proof
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
