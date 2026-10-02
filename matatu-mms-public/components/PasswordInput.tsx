"use client";

import { useState, forwardRef } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Set on dark-surface forms (e.g. the black onboarding page) so the eye
   * icon stays visible instead of near-black-on-black. */
  dark?: boolean;
}

/** A password `<input>` with a show/hide toggle — same `.input` styling as
 * every other field, just with room reserved on the right for the eye. */
const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className = "", dark = false, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <input {...props} ref={ref} type={visible ? "text" : "password"} className={`input pr-10 ${className}`} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
          className={
            dark
              ? "absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
              : "absolute right-3 top-1/2 -translate-y-1/2 text-county-ink/40 hover:text-county-ink/70"
          }
        >
          {visible ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";

export default PasswordInput;
