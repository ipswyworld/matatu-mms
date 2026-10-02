"use client";

import AuthPageShell from "@/components/AuthPageShell";
import MfaVerifyForm from "@/components/MfaVerifyForm";

export default function MfaVerifyPage() {
  return (
    <AuthPageShell
      eyebrow="County Staff Portal"
      heading="One more step"
      subheading="Your password checked out. Confirm it's really you with your authenticator app."
    >
      <MfaVerifyForm />
    </AuthPageShell>
  );
}
