import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set Up Two-Factor Authentication",
  description: "Admin and Superadmin accounts require two-factor authentication. Scan the QR code with your authenticator app to finish setup.",
};

export default function MfaSetupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
