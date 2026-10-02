import type { Metadata } from "next";
import fs from "fs";
import path from "path";
import { ScrollText } from "lucide-react";

export const metadata: Metadata = { title: "Changelog | Ops Console" };

function readChangelog(): string {
  const repoRoot = path.resolve(process.cwd(), "..");
  const candidate = path.join(repoRoot, "CHANGELOG.md");
  try {
    return fs.readFileSync(candidate, "utf-8");
  } catch {
    return "";
  }
}

/** Deliberately reads the plain markdown file rather than requiring a
 *  markdown renderer dependency — this console has none today, and a
 *  monospace pre block is perfectly readable for a changelog. */
export default function ChangelogPage() {
  const content = readChangelog();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink flex items-center gap-2">
          <ScrollText size={20} strokeWidth={2} />
          Changelog
        </h1>
        <p className="text-xs text-black/50 mt-0.5">What shipped, when, sourced from CHANGELOG.md at the repo root.</p>
      </div>

      <div className="card p-5">
        {content ? (
          <pre className="whitespace-pre-wrap text-xs text-county-ink/80 font-mono leading-relaxed">{content}</pre>
        ) : (
          <p className="text-xs text-black/40 italic">
            No CHANGELOG.md found at the repo root yet. Add one and entries will appear here automatically.
          </p>
        )}
      </div>
    </div>
  );
}
