"use client";

import AuthPageShell from "@/components/AuthPageShell";
import MfaSetupFlow from "@/components/MfaSetupFlow";

export default function MfaSetupPage() {
  return (
    <AuthPageShell
      eyebrow="County Staff Portal"
      heading="Secure your admin account"
      subheading="Two-factor authentication is required for Admin and Superadmin accounts before you can continue."
    >
      <MfaSetupFlow />
    </AuthPageShell>
  );
}
