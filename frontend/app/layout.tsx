import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const switzer = localFont({
  src: [
    {
      path: "../public/fonts/Switzer-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/Switzer-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/Switzer-Semibold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/fonts/Switzer-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-switzer",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mercurii Private Finance",
  description:
    "A private company operating account for receiving, holding, approving, paying, and reconciling stablecoins with controlled team and AI-agent access.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${switzer.variable} antialiased scroll-smooth`}>
      <body suppressHydrationWarning className={`${switzer.className} min-h-screen bg-[#F2F2F1] text-[#141a24] flex flex-col font-sans selection:bg-blue-600/10 selection:text-blue-900`}>
        {children}
      </body>
    </html>
  );
}
