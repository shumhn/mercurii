"use client";

import {
  Check,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  Bot,
  MoreHorizontal,
  ShieldCheck,
  LayoutDashboard,
  FileText,
  Users,
  Settings,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import { CrosshairGrid } from "@/components/ui/crosshair-grid";
import { motion } from "framer-motion";

export function Hero() {
  return (
    <section className="relative pt-8 sm:pt-14 pb-24 overflow-hidden">
      {/* Plus marks and crosshairs grid lines */}
      <CrosshairGrid />

      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Main Heading (Request Finance Exact 3-Line Layout) with Staggered Entrance Animation */}
        <div className="max-w-7xl">
          <motion.h1
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="font-display text-3xl/[1.2] sm:text-4xl/[1.18] md:text-5xl/[1.14] lg:text-[3.35rem]/[1.08] xl:text-[3.75rem]/[1.06] font-semibold tracking-tight"
          >
            <span className="text-[#141a24] sm:whitespace-nowrap block">
              Run your business on stablecoins.
            </span>
            <span className="text-gray-950/40 block mt-0.5 sm:mt-1">
              Keep its <span className="text-[#0b44fe]">financial operations private.</span>
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: "easeOut" }}
            className="mt-3 text-xl font-medium leading-tight tracking-tight text-gray-500 sm:mt-3.5 sm:text-2xl md:text-3xl"
          >
            Private treasury. Private payments. Team permissions. Bounded x402 agent payments.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.28, ease: "easeOut" }}
            className="mercury-section-copy mt-8 max-w-3xl text-gray-600"
          >
            Mercurii is a private company operating account for startups, agencies, and onchain teams
            to privately receive, hold, approve, pay, and reconcile stablecoins with controlled team and AI-agent access.
          </motion.p>

          {/* CTA Row with Spring Hover */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <motion.a
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.97 }}
              href="/app"
              className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-[#0b44fe] hover:bg-[#0038df] text-white text-sm sm:text-base font-medium transition-colors shadow-sm hover:shadow"
            >
              Launch on devnet
            </motion.a>

            <motion.a
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.97 }}
              href="#demo"
              className="inline-flex items-center justify-center px-6 py-2.5 rounded-full border border-gray-200/90 bg-white hover:bg-gray-50 text-gray-950 text-sm sm:text-base font-medium transition-colors shadow-xs"
            >
              Verify live proof
            </motion.a>

            <div
              aria-label="Built with Solana and MagicBlock"
              className="flex basis-full items-center gap-2.5 text-xs font-semibold text-gray-500 sm:ml-3 sm:basis-auto sm:border-l sm:border-gray-200 sm:pl-5 sm:text-sm"
            >
              <span className="mr-0.5 uppercase tracking-[0.12em] text-[10px] font-bold text-gray-400">
                Built with
              </span>
              <span className="inline-flex h-9 items-center gap-2 rounded-full border border-violet-200 bg-white px-3 shadow-sm">
                <Image
                  src="/brands/solana-mark.svg"
                  alt="Solana"
                  width={25}
                  height={22}
                  className="h-5 w-auto"
                />
                <span className="text-[#5c3bcf]">Solana</span>
              </span>
              <span className="inline-flex h-9 items-center rounded-full bg-[#1c1428] px-3.5 shadow-sm">
                <Image
                  src="/brands/magicblock-white.svg"
                  alt="MagicBlock"
                  width={126}
                  height={25}
                  className="h-[17px] w-auto"
                />
              </span>
            </div>
          </motion.div>

          {/* Trust Checkmarks */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.52 }}
            className="mt-4 flex items-center gap-x-6 text-xs sm:text-sm text-gray-600 font-normal"
          >
            <div className="flex items-center gap-x-1.5">
              <Check className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
              <span>Live on devnet</span>
            </div>
            <div className="flex items-center gap-x-1.5">
              <Check className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
              <span>Zero keys held</span>
            </div>
          </motion.div>

        </div>
      </div>

      {/* Product Mockup Container with Cinematic Elevation Reveal */}
      <motion.div
        initial={{ opacity: 0, y: 48, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 1.1, delay: 0.45, ease: "easeOut" }}
        className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 mt-12 sm:mt-16 relative"
      >
        {/* Outer Rounded Container with Blue Dot Grid Pattern - Balanced & Symmetrical */}
        <div className="relative rounded-[2.5rem] sm:rounded-[3rem] lg:rounded-[3.5rem] bg-white border border-blue-200/60 shadow-xl overflow-hidden px-4 sm:px-8 lg:px-12 pt-8 sm:pt-12 lg:pt-14 pb-12 sm:pb-14 lg:pb-16">
            {/* Dotted Grid Background Overlay (Subtle 14px micro-dot grid matching reference) */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: "radial-gradient(rgba(59, 130, 246, 0.20) 1px, transparent 1px)",
                backgroundSize: "14px 14px",
              }}
            />

            {/* Subtle top edge glass shine */}
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/80 via-white/20 to-transparent pointer-events-none" />

            {/* Mockup Frame Wrapper with breakout positioning for floating cards */}
            <div className="relative mx-auto max-w-6xl">
              {/* Inner App Window Mockup */}
              <div className="rounded-2xl sm:rounded-3xl bg-white border border-gray-200/90 shadow-2xl overflow-hidden">
                {/* Browser Window Bar */}
                <div className="h-11 px-4 bg-gray-50/90 border-b border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e]" />
                    <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123]" />
                    <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29]" />
                  </div>

                  {/* Top Breadcrumb */}
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <div className="flex items-center justify-center w-4 h-4 rounded bg-[#0b44fe] text-white text-[10px] font-bold">
                      M
                    </div>
                    <span className="font-semibold text-gray-900">Your Company</span>
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                  </div>

                  {/* Top Action Buttons */}
                  <div className="flex items-center gap-2">
                    <button className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#0b44fe] text-white text-xs font-semibold shadow-xs">
                      <span className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center text-[9px] font-bold">
                        M
                      </span>
                      <span>Pay Now</span>
                    </button>
                    <button className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Main Window Body with Sidebar + Content + Overlays */}
                <div className="flex flex-col md:flex-row relative min-h-[500px] lg:min-h-[540px]">
                  {/* Left Sidebar */}
                  <div className="hidden md:flex w-52 border-r border-gray-100 bg-[#fafafa]/90 p-4 flex-col justify-between shrink-0 select-none">
                    <div>
                      {/* Brand */}
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-5 h-5 rounded bg-[#0b44fe] text-white flex items-center justify-center font-bold text-xs tracking-tighter">
                          M
                        </div>
                        <span className="font-bold text-sm tracking-tight text-gray-950">
                          Mercurii
                        </span>
                      </div>

                      {/* Payment CTA */}
                      <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#0b44fe] text-white text-xs font-semibold shadow-xs mb-4">
                        <span>New payment</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>

                      {/* Company policy status */}
                      <div className="mb-4 px-1 py-1.5 rounded-lg bg-gray-100/60 border border-gray-200/50">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-gray-800 mb-1">
                          <span className="flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-[#0b44fe]" />
                            Company policy active
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] font-medium text-gray-500">
                          Private state · roles · spend caps
                        </div>
                      </div>

                      {/* Navigation Menu */}
                      <nav className="space-y-0.5 text-xs text-gray-600 font-medium">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer">
                          <LayoutDashboard className="w-3.5 h-3.5 text-gray-500" />
                          <span>Dashboard</span>
                        </div>

                        <div className="rounded-md bg-blue-50/60 text-[#0b44fe]">
                          <div className="flex items-center justify-between px-2.5 py-1.5 font-semibold cursor-pointer">
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-[#0b44fe]" />
                              <span>Payments</span>
                            </div>
                            <ChevronDown className="w-3 h-3 text-[#0b44fe]" />
                          </div>
                          <div className="pl-8 pb-1.5 space-y-1 text-[11px]">
                            <div className="font-semibold text-[#0b44fe] cursor-pointer">
                              Payment requests
                            </div>
                            <div className="text-gray-500 hover:text-gray-900 cursor-pointer">
                              Activity
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-100 text-gray-600 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-gray-500" />
                            <span>Payroll</span>
                          </div>
                          <ChevronRight className="w-3 h-3 text-gray-400" />
                        </div>

                        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-100 text-gray-600 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-gray-500" />
                            <span>Payees</span>
                          </div>
                          <ChevronRight className="w-3 h-3 text-gray-400" />
                        </div>

                        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-100 text-gray-600 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
                            <span>Team permissions</span>
                          </div>
                          <ChevronRight className="w-3 h-3 text-gray-400" />
                        </div>

                        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-100 text-gray-600 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Bot className="w-3.5 h-3.5 text-gray-500" />
                            <span>AI agents</span>
                          </div>
                          <ChevronRight className="w-3 h-3 text-gray-400" />
                        </div>
                      </nav>
                    </div>

                    <div className="pt-4 border-t border-gray-200/60">
                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-gray-100 text-gray-600 text-xs font-medium cursor-pointer">
                        <Settings className="w-3.5 h-3.5 text-gray-500" />
                        <span>Settings</span>
                      </div>
                    </div>
                  </div>

                  {/* Main Content Pane */}
                  <div className="flex-1 p-5 sm:p-8 bg-white relative">
                    {/* Top Breadcrumb & Invoice Heading */}
                    <div className="text-[11px] text-gray-400 font-medium mb-1">Overview</div>
                    <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-gray-950 mb-6">
                      <ArrowLeft className="w-4 h-4 text-gray-400" />
                      <span>Invoice INV-2026-0842</span>
                      <ArrowRight className="w-4 h-4 text-gray-400" />
                    </div>

                    {/* Two-Column Invoice Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs pb-6 border-b border-gray-100">
                      <div className="space-y-4">
                        <div>
                          <span className="text-gray-400 font-medium text-[11px] block">From</span>
                          <div className="flex items-center gap-1.5 font-bold text-gray-900 mt-0.5">
                            <span className="w-4 h-4 rounded-full bg-blue-100 text-[#0b44fe] flex items-center justify-center text-[9px] font-bold">
                              M
                            </span>
                            Your Company
                          </div>
                          <p className="text-gray-500 text-[11px] mt-0.5 leading-relaxed">
                            Your company address<br />
                            finance@yourcompany.com
                          </p>
                        </div>

                        <div>
                          <span className="text-gray-400 font-medium text-[11px] block">Billed to</span>
                          <p className="font-semibold text-gray-900 mt-0.5">Your client</p>
                          <p className="text-gray-500 text-[11px] mt-0.5 leading-relaxed">
                            Client billing address
                          </p>
                        </div>

                        <div>
                          <span className="text-gray-400 font-medium text-[11px] block">
                            Expected payment method
                          </span>
                          <p className="font-medium text-gray-800 text-[11px] mt-0.5">
                            Circle USDC
                          </p>
                          <p className="text-gray-500 text-[10px]">
                            Private payment flow
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4 sm:text-right flex flex-col justify-between sm:items-end">
                        <div>
                          <span className="text-gray-400 font-medium text-[11px] block">Invoice</span>
                          <p className="font-semibold text-gray-900 text-xs mt-0.5">
                            INV-2026-0842
                          </p>
                          <p className="text-gray-500 text-[11px] mt-0.5">Aug 14, 2026</p>
                          <p className="font-bold text-gray-950 text-base mt-2">18,450 USDC</p>
                          <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium text-[11px] border border-emerald-200">
                            Paid
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Line Item Table */}
                    <div className="pt-4 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-gray-400 text-[11px] border-b border-gray-100">
                            <th className="pb-2 font-medium">Description</th>
                            <th className="pb-2 font-medium text-center">Qty</th>
                            <th className="pb-2 font-medium text-right">Unit price</th>
                            <th className="pb-2 font-medium text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="text-gray-900 text-xs">
                            <td className="py-3 font-medium">Enterprise License</td>
                            <td className="py-3 text-center text-gray-500">1</td>
                            <td className="py-3 text-right font-medium">$18,450.00</td>
                            <td className="py-3 text-right font-semibold">$18,450.00</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Overlaid Center Modal ("Mercurii Private Treasury") */}
                    <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 pointer-events-none">
                      <div className="w-full max-w-[390px] rounded-2xl bg-white border border-gray-200/95 shadow-2xl p-5 sm:p-6 pointer-events-auto">
                        {/* Top Header Tab */}
                        <div className="flex justify-center mb-4">
                          <div className="px-4 py-1 rounded-lg border border-gray-200 bg-gray-50/80 text-[11px] font-semibold text-gray-800 tracking-tight">
                            Mercurii Private Treasury
                          </div>
                        </div>

                        {/* Dropdown Selector */}
                        <div className="mb-3.5">
                          <div className="p-3 rounded-xl border border-gray-200 flex items-center justify-between bg-white hover:border-gray-300 transition-colors cursor-pointer">
                            <div className="flex items-center gap-2.5">
                              <div className="w-6 h-6 rounded-md bg-gray-900 text-white flex items-center justify-center text-xs">
                                <Wallet className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-xs font-semibold text-gray-900">
                                Mercurii Private Treasury
                              </span>
                            </div>
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          </div>
                          <div className="text-[11px] text-gray-500 font-medium mt-1 px-1">
                            Balance: •••,••• USDC
                          </div>
                        </div>

                        {/* Payment Reference Input */}
                        <div className="mb-5">
                          <label className="text-[11px] text-gray-500 font-medium block mb-1">
                            Payment reference (optional)
                          </label>
                          <input
                            type="text"
                            readOnly
                            value="Invoice INV-2026-0842"
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-900 bg-white"
                          />
                        </div>

                        {/* Primary Blue Button */}
                        <button className="w-full py-2.5 rounded-xl bg-[#0b44fe] hover:bg-[#0038df] text-white text-xs sm:text-sm font-semibold transition-colors shadow-sm">
                          Continue
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Overlaid Floating Balance Card with Levitation Motion */}
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
                whileHover={{ scale: 1.03, y: -12 }}
                className="absolute -bottom-6 -right-2 sm:-bottom-7 sm:right-4 lg:-bottom-7 lg:right-6 rounded-2xl bg-white border border-gray-200/90 shadow-[0_20px_50px_rgba(0,0,0,0.14)] p-5 sm:p-6 w-72 sm:w-80 z-30 pointer-events-auto cursor-pointer"
              >
                <div className="flex items-center justify-between text-sm sm:text-[15px] font-bold text-gray-950 mb-4 sm:mb-5">
                  <span>Mercurii Private Treasury</span>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                </div>

                <div className="space-y-3.5 sm:space-y-4 text-xs sm:text-[13px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#2775ca] text-white flex items-center justify-center text-[9px] font-bold shadow-xs">
                        USDC
                      </span>
                      <span className="font-bold text-gray-900">Circle USDC</span>
                    </div>
                    <span className="font-medium text-gray-900 font-mono text-xs sm:text-sm">
                      •••,••• USDC
                    </span>
                  </div>
                </div>

                <div className="mt-4 sm:mt-5 pt-3.5 sm:pt-4 border-t border-gray-100 flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-gray-500 font-medium">Total Balance</span>
                  <span className="font-bold text-gray-950 font-mono text-sm sm:text-base">
                    •••,••• USDC
                  </span>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </section>
    );
}
