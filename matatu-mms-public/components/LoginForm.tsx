"use client";

import { useFormState, useFormStatus } from "react-dom";
import { LogIn, Loader2 } from "lucide-react";
import { loginAction } from "@/lib/actions";
import { useLanguage } from "@/components/LanguageProvider";
import PasswordInput from "@/components/PasswordInput";

function SubmitButton() {
  const { pending } = useFormStatus();
  const { t } = useLanguage();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2" disabled={pending}>
      {pending ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} strokeWidth={2} />}
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
          {/* type="text", not "email" — this field also accepts a phone
              number (and, for crew, their crew number — not advertised in
              the label/placeholder to keep the field's wording short, but
              still accepted: the backend resolves this value against
              email, phone, AND crew_number, see routes/auth.py's login()).
              A plain "email" input would fail its native format validation
              on any of those before the request ever reaches the backend. */}
          <input
            className="input"
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            placeholder="0712 345 678 or you@nairobi.go.ke"
            required
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="label !mb-0" htmlFor="password">{t("login.password")}</label>
            <a href="/forgot-password" className="text-[11px] font-bold text-county-green hover:underline shrink-0">
              {t("login.forgotPassword")}
            </a>
          </div>
          <PasswordInput className="mt-1.5" id="password" name="password" placeholder="••••••••" required />
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-county-ink/70 cursor-pointer select-none">
          <input type="checkbox" name="rememberMe" className="h-4 w-4 rounded border-black/20 text-county-green focus:ring-county-green/40" />
          {t("login.rememberMe")}
        </label>

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
