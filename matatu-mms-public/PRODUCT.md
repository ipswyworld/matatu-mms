# Product

## Register

product (with brand-weighted visual identity — see Design Principles)

## Users

Five distinct roles, each with a different context and stakes:
- **Passengers**: commuters booking/scheduling matatu seats and reporting issues (overcharging, safety) from a phone, often on the move.
- **Crew (driver/conductor)**: managing seat occupancy, validating tickets, and streaming live GPS from inside a moving vehicle — needs large touch targets and glanceable state, not dense text.
- **Enforcement officers**: county traffic officers reviewing compliance, fines, and citations at a desk or in the field.
- **Sacco operators**: matatu association staff onboarding vehicles and managing licensing/verification paperwork.
- **Admins**: county government staff overseeing the whole system — fleet, fines, revenue, users.

## Product Purpose

A Nairobi City County Government system that brings matatu (minibus transit) operations onto one real-time backbone: fleet registration, live GPS telemetry, seat booking, fare compliance, and enforcement, all wired to the same event pipeline so an action in one role (a booking, a fine, a passenger report) is immediately visible to the roles it affects. Success looks like: officers trust the compliance data because it's real, sacco operators onboard vehicles without friction, and passengers can see and book a real vehicle in real time — not a static schedule.

## Brand Personality

Authoritative, energetic, modern, approachable. It should read first as a credible, in-control county system (not a template SaaS admin panel, not a dated bureaucratic portal) — then carry a distinct energy that Nairobi's matatu culture is known for (bold liveries, color, motion) expressed through restrained accents, not costume. Weighted roughly 65% institutional authority / 35% street energy: enough to feel unmistakably Nairobi, never enough to undercut it as a compliance tool.

## Anti-references

- Generic corporate SaaS dashboard: templated blue/gray/white admin panel with no local identity, interchangeable with any other B2B tool.
- Dated 2010s government portal: clip-art icons, cramped bureaucratic forms, no visual hierarchy.
- Kitsch matatu theme: graffiti/livery motifs used as loud decoration that undermine the tool's credibility as a compliance system. Matatu culture shows up as a confident accent, not the whole outfit.

## Design Principles

1. **County identity carries real weight, not just accent color.** Green/yellow/black should read as the system's institutional identity across all five dashboards, not a sprinkle on top of a gray admin template.
2. **Matatu energy is a disciplined accent, not a costume.** Livery-style motifs, illustrated vehicles, bold color blocking appear at specific, intentional moments (empty states, live indicators, card treatments) — never at the expense of legibility or density where officers/operators need to scan data fast.
3. **One system, five doors.** Bookings, fines, reports, and telemetry genuinely flow between roles in the real backend — the visual language (status pills, live indicators, iconography) should make that interconnectedness legible, so the five dashboards read as one product.
4. **Design for the context of use, not just the screen.** Crew is often mid-shift on a phone; officers and operators are scanning tables at a desk. Density and touch-target size should flex per role, not use one generic layout everywhere.
5. **Real data, real states.** Every screen was recently rewired from mock data to a live FastAPI backend — design must account for genuine empty/loading/error states, not just the happy path with fake data pre-filled.

## Accessibility & Inclusion

WCAG 2.1 AA as the baseline (government system, public-facing passenger surface). Body text ≥4.5:1 contrast, large/bold text ≥3:1. Respect `prefers-reduced-motion` for live-indicator pulses and map marker animation. Status must never be conveyed by color alone (fines/bookings/vehicle status use color + label + icon).
