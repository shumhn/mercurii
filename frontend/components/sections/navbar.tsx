"use client";

import { useState } from "react";
import Image from "next/image";
import { Menu, X } from "lucide-react";

type NavLink = {
  href: string;
  label: string;
  external?: boolean;
};

const links: NavLink[] = [
  { href: "#story", label: "Story" },
  { href: "#proof", label: "Proof" },
  { href: "#faq", label: "FAQ" },
  { href: "https://github.com/shumhn/mercury", label: "Docs", external: true },
  { href: "#resources", label: "Resources" },
];

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <header className="relative z-30 pt-6 sm:pt-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between border-b border-black/[0.06] pb-4">
          <a href="#" className="flex items-center gap-2.5" aria-label="Mercurii home">
            <span className="relative block size-10 shrink-0">
              <Image
                src="/mercurii-symbol-blue.png"
                alt=""
                fill
                sizes="40px"
                className="object-contain"
                priority
              />
            </span>
            <span className="text-xl font-bold tracking-tight text-gray-950">Mercurii</span>
          </a>

          <nav className="hidden items-center gap-6 text-sm font-medium text-gray-900 xl:flex xl:gap-7" aria-label="Primary navigation">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noreferrer" : undefined}
                className="py-2 transition-colors hover:text-[#0b44fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b44fe] focus-visible:ring-offset-2"
              >
                {link.label}
              </a>
            ))}
            <a
              href="/app"
              className="py-2 transition-colors hover:text-[#0b44fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b44fe] focus-visible:ring-offset-2"
            >
              Open app
            </a>
            <a
              href="/app"
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#0b44fe] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0038df] hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b44fe] focus-visible:ring-offset-2"
            >
              Launch on devnet
            </a>
          </nav>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
            className="rounded-lg p-2 text-gray-700 transition-colors hover:bg-gray-100 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b44fe] focus-visible:ring-offset-2 xl:hidden"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <nav className="mt-3 space-y-1 rounded-2xl border border-gray-200 bg-white p-4 text-sm font-medium text-gray-900 shadow-xl xl:hidden" aria-label="Mobile navigation">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noreferrer" : undefined}
                onClick={closeMobileMenu}
                className="block rounded-lg px-2 py-2 transition-colors hover:bg-gray-50 hover:text-[#0b44fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b44fe]"
              >
                {link.label}
              </a>
            ))}
            <a
              href="/app"
              onClick={closeMobileMenu}
              className="block rounded-lg px-2 py-2 transition-colors hover:bg-gray-50 hover:text-[#0b44fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b44fe]"
            >
              Open app
            </a>
            <a
              href="/app"
              onClick={closeMobileMenu}
              className="mt-2 flex min-h-10 w-full items-center justify-center rounded-full bg-[#0b44fe] px-4 py-2.5 text-center text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b44fe] focus-visible:ring-offset-2"
            >
              Launch on devnet
            </a>
          </nav>
        )}
      </div>
    </header>
  );
}
