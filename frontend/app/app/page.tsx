import type { Metadata } from "next";
import { MercuriiApp } from "@/components/app/mercurii-app";

export const metadata: Metadata = {
  title: "Workspace — Mercurii",
  description: "Mercurii private stablecoin operations workspace.",
};

export default function WorkspacePage() {
  return <MercuriiApp />;
}
