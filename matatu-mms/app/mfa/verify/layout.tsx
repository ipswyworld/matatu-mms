import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify Sign-In",
  description: "Enter your authenticator app code to finish signing in to Nairobi City County's Mji-Move platform.",
};

export default function MfaVerifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
