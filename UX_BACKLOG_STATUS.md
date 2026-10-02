# Non-Technical UX Backlog Status (Task 21, ARCHITECTURE_DECISIONS.md §24)

§24.14 is explicit: **"these are product/UX work items, not architecture... should be
broken into individual design/build tickets rather than treated as one task."** This
records what's been checked/built against the doc's own ★ highest-leverage list, and
leaves the rest as the working backlog the doc already frames it as — not something to
fake-complete as one pass.

## Checked or built in this pass

- **#28 No stack traces, ever.** Verified: `FastAPI()` is instantiated without
  `debug=True` (`backend/app/main.py`), so an unhandled exception already returns a
  generic 500 with no traceback in the response body — traceback only reaches server
  logs. Already compliant, no change needed.
- **#13 Narrative insight lines** and **#14 Comparisons/targets with a trend arrow** —
  built into `FinesTrendChart` (Task 19): a plain-language sentence ("Trending up 12%
  versus earlier in this range") computed by comparing the first half of the loaded
  window against the second half, with a text arrow (↑/↓) alongside the sentence — never
  color alone, satisfying #33 for this component specifically.
- **#20 Explicit freshness** — already exists elsewhere in the app (`LiveIndicator`,
  `DashboardLiveRefresh` per the doc's own §24.4 reference); not newly built here, just
  confirmed it's the existing pattern new widgets should reuse rather than reinvent.

## Not done — genuinely a large, separate body of work

The remaining ~47 items span onboarding tours, global search, breadcrumbs, full EN/SW
parity audits, WCAG AA compliance passes, scheduled email reports, saved views, and
icon-system standardization — each independently sized product/design work, exactly as
§24.14 describes. Attempting all of them in one pass would mean shallow, unverified
changes across dozens of files rather than real ones; the doc's own guidance is followed
here instead: this is a backlog, prioritized by the ★ list, for `/impeccable`-driven
ticket-by-ticket work per §24.14's own instruction — not a checklist to rush through.

**Recommended next tickets, in the doc's stated priority order:**
1. Role-based default landing page (#1) — partially exists (middleware routes each role
   to a home page already); confirm it actually answers "the main question" per role
   rather than just being *a* landing page.
2. Plain language audit (#11) — grep for raw enum/field names leaking into UI copy.
3. RAG/traffic-light status, colour-independent (#15, #33) — audit every status pill for
   icon/label pairing, not just color.
4. Low-bandwidth tolerance (#37) — bundle-size audit, given the passenger app targets
   modest Android phones on patchy networks.
5. Visible provenance (#38) — surfaces once IRMS integration (§9.1, currently blocked)
   lands; not buildable before that external dependency resolves.
