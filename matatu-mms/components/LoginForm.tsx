"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "@/lib/actions";
import { useLanguage } from "@/components/LanguageProvider";

function SubmitButton() {
  const { pending } = useFormStatus();
  const { t } = useLanguage();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base" disabled={pending}>
      {pending ? t("login.signingIn") : t("login.signIn")}
    </button>
  );
}

interface LoginFormProps {
  tagline: string;
}

// Shared by the public portal ("/") and staff sign-in ("/login") — same
// credentials, same backend action, same post-login role-based redirect in
// middleware.ts. Only the surrounding page chrome (heading, links, demo
// accounts) differs between the two.
export default function LoginForm({ tagline }: LoginFormProps) {
  const [state, formAction] = useFormState(loginAction, undefined);
  const { t } = useLanguage();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl font-black tracking-tight text-county-ink">{t("login.signIn")}</h2>
        <p className="text-sm text-county-ink/55 mt-2">{tagline}</p>
      </div>

      <form action={formAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">{t("login.email")}</label>
          <input className="input" id="email" name="email" type="email" placeholder="you@nairobi.go.ke" required />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="password">{t("login.password")}</label>
            <a href="/forgot-password" className="text-[11px] font-bold text-county-green hover:underline">
              {t("login.forgotPassword")}
            </a>
          </div>
          <input className="input" id="password" name="password" type="password" placeholder="••••••••" required />
        </div>

        {state?.error && (
          <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
            {state.error}
          </div>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
