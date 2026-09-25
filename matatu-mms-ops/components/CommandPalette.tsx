"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command, CornerDownLeft, Search } from "lucide-react";
import { NAV_ITEMS } from "./OpsNav";
import { ACTION_CLASS_META, OPS_ACTIONS } from "@/lib/opsActions";

/** Where each action lives, so selecting it from the palette lands on the
 *  panel that owns it. The palette navigates; it never fires an action
 *  directly, so nothing can bypass <ActionButton>'s confirmation. */
const ACTION_ROUTES: Record<string, string> = {
  "flag.create": "/config",
  "flag.toggle": "/config",
  "flag.delete": "/config",
  "rateLimit.update": "/config",
  "job.retry": "/jobs",
  "job.cancel": "/jobs",
  "job.retryAllFailed": "/jobs",
  "webhook.replay": "/integrations",
  "breaker.override": "/integrations",
  "session.revoke": "/sessions",
  "user.lock": "/sessions",
  "user.unlock": "/sessions",
  "user.resetMfa": "/sessions",
  "impersonate.start": "/sessions",
  "apiClient.create": "/api-clients",
  "apiClient.revoke": "/api-clients",
  "deploy.trigger": "/infrastructure",
  "deploy.rollback": "/infrastructure",
  "cost.record": "/infrastructure",
  "config.revert": "/config",
  "backup.testRestore": "/infrastructure",
  "retention.scanNow": "/compliance",
  "dsr.update": "/compliance",
  "dataQuality.scanNow": "/compliance",
};

interface Entry {
  kind: "page" | "action";
  label: string;
  hint: string;
  href: string;
  chip?: string;
  chipLabel?: string;
}

/**
 * Fast keyboard access to any page or action (Ops Console Rebuild Spec §5.3).
 *
 * At 3am, typing the name of the thing you need beats navigating to it.
 * Deliberately an accelerator only: selecting an action routes to the panel
 * that owns it rather than executing anything, so the confirmation and
 * reason capture in <ActionButton> can never be skipped by knowing a
 * shortcut.
 */
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = NAV_ITEMS.map((n) => ({
      kind: "page",
      label: n.label,
      hint: n.hint,
      href: n.href,
    }));
    const actions: Entry[] = Object.values(OPS_ACTIONS).map((a) => {
      const meta = ACTION_CLASS_META[a.actionClass];
      return {
        kind: "action",
        label: a.label,
        hint: a.affectedScope,
        href: ACTION_ROUTES[a.id] ?? "/",
        chip: meta.chip,
        chipLabel: meta.label,
      };
    });
    return [...pages, ...actions];
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q),
    );
  }, [entries, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setCursor(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setCursor(0), [query]);

  function choose(entry: Entry | undefined) {
    if (!entry) return;
    setOpen(false);
    router.push(entry.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-1.5 text-[11px] font-bold text-white/55 hover:text-white/85 border border-white/15 rounded-lg px-2 py-1 transition-colors"
      >
        <Search size={12} />
        Search
        <span className="inline-flex items-center gap-0.5 text-[9px] text-white/40 ml-1">
          <Command size={9} />K
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-black/10 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-black/10">
              <Search size={15} className="text-black/30 shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, results.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    choose(results[cursor]);
                  }
                }}
                placeholder="Jump to a page or action…"
                className="flex-1 text-sm outline-none placeholder:text-black/30"
              />
            </div>

            <div className="max-h-80 overflow-y-auto py-1">
              {results.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-black/40">No matches.</div>
              )}
              {results.map((entry, i) => (
                <button
                  key={`${entry.kind}-${entry.label}-${i}`}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(entry)}
                  className={`w-full text-left px-4 py-2 flex items-center justify-between gap-3 ${
                    i === cursor ? "bg-county-green/8" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-county-ink truncate">{entry.label}</div>
                    <div className="text-[10px] text-black/45 truncate">{entry.hint}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {entry.chipLabel && (
                      <span className={`badge text-[9px] font-extrabold ${entry.chip}`}>
                        {entry.chipLabel.toUpperCase()}
                      </span>
                    )}
                    {i === cursor && <CornerDownLeft size={11} className="text-black/25" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
