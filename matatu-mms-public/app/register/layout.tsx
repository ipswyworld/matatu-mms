import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create an Account",
  description: "Register as a commuter passenger or matatu crew member on Nairobi City County's Mji-Move platform.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
