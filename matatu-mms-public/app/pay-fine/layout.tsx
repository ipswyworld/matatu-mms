import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pay a Citation Fine",
  description: "Look up and settle an outstanding matatu citation fine issued by Nairobi County Traffic Enforcement.",
};

export default function PayFineLayout({ children }: { children: React.ReactNode }) {
  return children;
}
