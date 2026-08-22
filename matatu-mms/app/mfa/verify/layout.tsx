import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify Sign-In",
  description: "Enter your authenticator app code to finish signing in to the Nairobi City County Matatu Management System.",
};

export default function MfaVerifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
