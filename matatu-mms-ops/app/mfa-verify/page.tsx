import { ShieldCheck } from "lucide-react";
import MfaVerifyForm from "@/components/MfaVerifyForm";

export default function MfaVerifyPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-xl bg-county-green-deep flex items-center justify-center">
            <ShieldCheck size={22} className="text-county-yellow" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-county-ink">One more step</h1>
          <p className="text-sm text-county-ink/55">
            Enter the code from your authenticator app, or a backup code.
          </p>
        </div>
        <div className="card p-6">
          <MfaVerifyForm />
        </div>
      </div>
    </div>
  );
}
