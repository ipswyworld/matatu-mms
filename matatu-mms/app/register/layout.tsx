import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create an Account",
  description: "Register as a commuter passenger or matatu crew member on the Nairobi City County Matatu Management System.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
