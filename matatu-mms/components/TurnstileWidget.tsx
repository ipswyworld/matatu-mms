"use client";

import { useEffect } from "react";

const SCRIPT_ID = "cf-turnstile-script";

/**
 * Cloudflare Turnstile — bot protection on login/register/password-reset
 * (MULTI_STAKEHOLDER_REVIEW.md Phase 2, Security Checklist #12).
 *
 * Renders nothing when no site key is configured — same inert-until-
 * configured stance as the backend half (app/turnstile.py): every
 * deployment without a Turnstile site created yet (which is every
 * deployment today) behaves exactly as before, with no missing-widget
 * gap in the form. Uses Turnstile's implicit-render mode: the script
 * itself finds the `cf-turnstile` div and injects a hidden
 * `cf-turnstile-response` input into the surrounding <form> — which is
 * why this needs no controlled React state to wire up; the existing
 * FormData-based server action (lib/actions.ts) picks it up by name like
 * any other field.
 */
export default function TurnstileWidget() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) return;
    if (document.getElementById(SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, [siteKey]);

  if (!siteKey) return null;

  return <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />;
}
