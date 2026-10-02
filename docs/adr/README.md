# Architecture Decision Records

One file per decision, going forward, instead of appending indefinitely to
the single `ARCHITECTURE_DECISIONS.md` (MULTI_STAKEHOLDER_REVIEW.md Phase
3 item 11). That file stays as the historical record of everything
decided before this practice started — it isn't being split apart
retroactively, since that would cost real effort for no one's benefit.
New architecturally-significant decisions get their own ADR here instead.

**When to write one**: a decision that would be expensive to reverse, that
future engineers will otherwise have to reconstruct the reasoning for from
git history, or that a second AI/reviewer might reasonably challenge
without knowing the constraint that drove it. Not every code change —
most of this codebase's day-to-day work correctly doesn't get one.

**Format**: copy `0000-template.md`, number it sequentially, fill it in.
Keep it short — a good ADR is closer to half a page than five.
