import type { Metadata } from "next";
import { MercuriiWorkspace } from "@/components/app/mercurii-workspace";

export const metadata: Metadata = {
  title: "Workspace — Mercurii",
  description: "Mercurii private stablecoin operations workspace.",
};

export default function WorkspacePage() {
  return <MercuriiWorkspace />;
}
