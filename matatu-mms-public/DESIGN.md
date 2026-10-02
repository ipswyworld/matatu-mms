---
name: Mji-Move
description: Nairobi City County's real-time matatu compliance, booking, and fleet system
colors:
  county-green: "#068930"
  county-green-dark: "#045A20"
  county-yellow: "#FCDD07"
  county-blue: "#0F47AF"
  county-red: "#CE1126"
  county-black: "#121824"
  county-cream: "#F9FAF6"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.25rem, 2vw, 1.75rem)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.7rem"
    fontWeight: 700
    letterSpacing: "0.05em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.county-green}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.county-green-dark}"
  badge-live:
    backgroundColor: "{colors.county-green}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "2px 10px"
  card-default:
    backgroundColor: "#ffffff"
    rounded: "{rounded.md}"
---

# Design System: Mji-Move

## 1. Overview

**Creative North Star: "The County Corridor"**

Two things are true about a matatu corridor at once: it's an official, licensed transit artery run by county government, and it's a living stretch of Nairobi street culture: livery colors, hand-painted slogans, sound, motion. This system is built the same way. Its base register is a county government compliance tool: officers reviewing citations, sacco operators filing paperwork, admins reconciling revenue. That base carries roughly two-thirds of the visual weight, in county-black, county-green, and county-cream. The remaining third is matatu energy: county-yellow used as a live/action signal rather than decoration, and livery-inspired accent treatments (diagonal corner marks, bold corridor-color strips) that appear at specific, deliberate moments rather than as ambient texture.

This explicitly rejects the generic corporate SaaS dashboard (blue-gray-white, no local identity, interchangeable with any B2B admin panel), the dated 2010s government portal (clip-art, cramped forms, no hierarchy), and a kitsch matatu costume where graffiti motifs undercut the tool's credibility as a compliance system.

**Key Characteristics:**
- County-black as the institutional anchor color (headers, sidebar, high-authority surfaces).
- County-yellow reserved for live state, emphasis, and action — never a base color.
- Matatu livery accents live in named slots: empty states, live/telemetry indicators, vehicle cards, loading states. They do not appear on data tables or forms.
- Flat, tonal surfaces at rest; elevation appears only for floating/overlay panels (map, seat chart, modals).

## 2. Colors

The palette is Nairobi County's own flag colors, used with government-grade restraint and one energetic exception (yellow) that's allowed to move and pulse.

### Primary
- **County Black** (`#121824`): the institutional anchor. Sidebar, header bars, the live-map canvas, high-authority data surfaces (seat charts, GPS telemetry). Reads as "this is the county system," not an accent.
- **County Green** (`#068930`, dark variant `#045A20`): the primary action and compliance color. Primary buttons, active nav state, "compliant"/"active"/"confirmed" status, the sidebar's active-route indicator.

### Secondary
- **County Yellow** (`#FCDD07`): reserved exclusively for live/real-time signals and singular emphasis — the pulsing live-GPS dot, the "LIVE" badge, a matatu's headlights in the map marker, the sidebar's active-item accent bar. Never used as a body background or a default button color; its rarity is what makes it read as "this is moving, right now."
- **County Blue** (`#0F47AF`): secondary informational accent — booked/selected seat state, "in transit" vehicle markers, links.

### Tertiary
- **County Red** (`#CE1126`): reserved for genuine alerts — impounded vehicles, disputed fines, destructive actions, overcharging reports. Never decorative.

### Neutral
- **County Cream** (`#F9FAF6`): the default page background. Warm enough to feel official-paper, not sterile white.
- **White** (`#FFFFFF`): card and surface background, sits on cream.
- **Black/5–Black/60 (Tailwind opacity scale on `#121824`)**: all secondary text, borders, and dividers derive from tinted county-black at varying opacity, never a separate gray scale — keeps every neutral tied to the same institutional hue.

### Named Rules
**The Yellow Discipline Rule.** County-yellow signals "live" or "act now" and nothing else. If a yellow element isn't currently moving, pulsing, or asking for a decision, it's the wrong color.

**The Two-Thirds Rule.** Any given screen should read as roughly two-thirds county-black/green/cream (institutional) and at most one-third yellow/blue/livery accent (energy). Data-dense screens (fines ledger, audit log, users table) skew further toward the institutional two-thirds; passenger-facing screens (booking, seat map) can lean closer to the line.

## 3. Typography

**Display Font:** system-ui (San Francisco / Segoe UI / Roboto depending on OS), with `-apple-system, 'Segoe UI', sans-serif` fallback
**Body Font:** same system-ui stack
**Label/Mono Font:** system-ui for labels; `font-mono` (system monospace) for plate numbers, ticket IDs, and coordinates — anywhere a value must be scanned character-by-character.

**Character:** One typeface, carrying hierarchy through weight and scale rather than a second family — appropriate for a government tool where a serif/sans pairing would read as decorative rather than functional. Extrabold weights (800) at the display tier give headers real authority without needing a distinct display face.

### Hierarchy
- **Display** (800, `clamp(1.25rem, 2vw, 1.75rem)`, 1.2 line-height): page/section titles ("Commuter Passenger Portal", "Enforcement Operations Hub").
- **Title** (700, 0.95rem, 1.3 line-height): card and panel headers.
- **Body** (400, 0.875rem, 1.5 line-height): all reading text, table cells, descriptions. Cap prose blocks (complaint text, remarks) at ~70ch.
- **Label** (700, 0.7rem, 0.05em tracking, uppercase): form labels, table headers, badges. Uppercase is reserved for labels this short; never for sentences.

### Named Rules
**The One Mono Rule.** `font-mono` is reserved for plate numbers, booking/ticket IDs, and coordinates. Using it elsewhere (body copy, headers) dilutes its "this is a precise, scannable identifier" signal.

## 4. Elevation

Flat by default, tonal layering does most of the depth work (white cards on cream background, county-black panels on white). Shadow appears only where a surface genuinely floats above the page: the live GIS map, the seat-map panel, modals, and dropdowns. Data tables, forms, and stat cards stay flat or use a soft resting shadow that intensifies on hover, never a resting drop shadow that fights with the tonal layering.

### Shadow Vocabulary
- **Resting card** (`shadow-sm` → `shadow-md` on hover): default card surfaces (`.card` in globals.css). Signals "this is interactive" through the hover lift, not through a heavy resting shadow.
- **Floating panel** (`shadow-xl` / `shadow-2xl`): the GIS map, seat-map, and modals — surfaces that represent a distinct layer above the page, not a member of the page grid.
- **Inset** (`shadow-inner`): seat buttons and the vehicle-chassis seat map body, to read as a physical recessed compartment rather than a flat card.

### Named Rules
**The Float Justifies Depth Rule.** A shadow's size should match how far above the page the element conceptually sits. A stat card gets a whisper (`shadow-sm`); the live map, which is a whole separate real-time surface, earns `shadow-2xl`.

## 5. Components

### Buttons
- **Shape:** rounded corners (`rounded-lg`, 8px) — soft enough to feel approachable on a government tool, not fully pill-shaped (which would skew too playful/consumer).
- **Primary:** county-green background, white text, `px-4 py-2`, `font-semibold`. Darkens to county-green-dark on hover, `active:scale-95` for tactile press feedback.
- **Danger:** county-red background, white text — reserved for destructive/citation actions (issue fine, dismiss report, impound).
- **Secondary/Ghost:** white background, county-black/10 border, county-black text; hover fills with county-black/5.

### Chips / Status Pills (`badge` class)
- **Style:** fully rounded (`rounded-full`), `px-2.5 py-0.5`, small/semibold text. Background is always the status color at 10% opacity with full-opacity text of the same hue (e.g. county-green/10 bg + county-green text for ACTIVE), never a solid-fill badge — keeps the dense tables (fines, matatus, reports) from turning into a wall of solid color blocks.
- **Live variant:** the one exception — solid county-green fill, white text, paired with a small pulsing yellow or green dot, for "LIVE" / "Live Synced" indicators specifically (never for static status).

### Cards / Containers
- **Corner Style:** `rounded-xl` (12px) as the default; `rounded-2xl`/`rounded-3xl` (16–24px) for feature surfaces like the seat map and map panel, signaling "this is a bigger, more important surface."
- **Background:** white on the cream page background; county-black for the "control panel" surfaces (map header bar, seat-map chassis, crew telemetry bar) that should read as dashboard-instrument, not paper-document.
- **Shadow Strategy:** see Elevation.
- **Border:** `border-black/5` hairline by default; `border-2 border-county-green/30` for the emphasized/selected state (e.g. the primary route card in sacco-portal).
- **Internal Padding:** `p-4` to `p-6` depending on density; officer/admin data-table cards can go tighter (`p-4`), passenger-facing feature cards stay generous (`p-5`/`p-6`).

### Inputs / Fields
- **Style:** `rounded-lg`, `border-black/15`, white background, `px-3 py-2`.
- **Focus:** `ring-2 ring-county-green/30` plus a county-green border — ties every focus state back to the primary brand color rather than a generic blue focus ring.
- **Label:** uppercase, 0.7rem, `text-black/50`, `tracking-wide` — sits directly above the field.

### Navigation (Sidebar)
- **Style:** county-black background, full height, white/70 text at rest.
- **Active state:** county-green fill on the active item, white text, plus a county-yellow accent bar on the item's left edge (2px, `rounded-r`) — the one place a thin colored edge is allowed, because it's a functional "you are here" marker, not decoration.
- **Hover (inactive):** `bg-white/5`, text brightens to full white.
- **Footer:** the three-color county stripe (green/yellow/blue, equal thirds) as a small brand mark, no logotype needed.

### Live/Real-Time Indicator (signature component)
The recurring cross-dashboard signal for "this is happening right now": a small dot (county-green at rest, or county-yellow when actively transmitting) with a `animate-ping` halo, paired with a short label ("Live Synced", "GPS Broadcast: ON", "Connecting…"). Used identically across GisMap, CrewPortalClient's GPS toggle, and any future live indicator — so a user who's seen it once on the passenger map recognizes it instantly on the crew dashboard. Must degrade gracefully under `prefers-reduced-motion` to a static filled dot, no pulse.

## 6. Do's and Don'ts

### Do:
- **Do** use county-black as the base for any "instrument panel" surface (map, seat chart, telemetry bar) — it should feel like dashboard hardware, not a white card with data in it.
- **Do** reserve county-yellow for genuinely live or actionable moments (`animate-ping` dots, "LIVE" badges, primary CTAs on the booking flow) — per the Yellow Discipline Rule.
- **Do** apply the same live-indicator pattern (pulsing dot + label) identically across all five dashboards so the system reads as one product.
- **Do** use livery/matatu accents (diagonal corner marks, corridor-color strips) only in the named slots: empty states, vehicle cards, live badges, loading states.
- **Do** keep data-dense surfaces (fines ledger, audit trail, users table) closer to flat county-black-on-cream with minimal color noise, so officers can scan fast.

### Don't:
- **Don't** ship a generic corporate SaaS dashboard: no interchangeable blue-gray-white admin-panel look with no Nairobi identity.
- **Don't** replicate a dated 2010s government portal: no clip-art icons, no cramped bureaucratic forms, no flat hierarchy.
- **Don't** let matatu graffiti/livery motifs become kitsch: no loud decorative patterns on forms, tables, or anywhere data needs to be scanned quickly. Livery is an accent in specific slots, not a wallpaper.
- **Don't** use `border-left`/`border-right` as a colored accent stripe anywhere except the sidebar's active-nav-item marker (the one functional exception, called out above).
- **Don't** use county-yellow as a background fill for large surfaces or as a default (non-live) button color — it reads as noise the moment it stops meaning "live."
- **Don't** convey status by color alone: every status pill pairs color with a text label (ACTIVE, FLAGGED, PENDING), never a bare colored dot.
