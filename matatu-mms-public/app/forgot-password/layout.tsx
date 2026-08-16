import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Your Password",
  description: "Request a password reset link for your Matatu Management System account.",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
