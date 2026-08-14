import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to the Nairobi City County Matatu Management System with your county-issued credentials.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
