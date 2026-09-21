import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "County Staff Sign In",
  description: "Sign in to Nairobi City County's Mji-Move platform staff portal with your county-issued credentials.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
