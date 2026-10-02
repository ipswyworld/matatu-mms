interface MatatuGlyphProps {
  className?: string;
  size?: number;
}

/**
 * Side-view matatu silhouette with a county-livery stripe. Used only in the
 * named accent slots (empty states, brand mark, vehicle cards) — never on
 * data-dense surfaces. See DESIGN.md's Livery accent rule.
 */
export default function MatatuGlyph({ className = "", size = 48 }: MatatuGlyphProps) {
  return (
    <svg
      viewBox="0 0 64 40"
      width={size}
      height={(size * 40) / 64}
      className={className}
      role="img"
      aria-label="Matatu"
    >
      <rect x="4" y="12" width="56" height="18" rx="4" fill="currentColor" />
      <rect x="4" y="17" width="56" height="5" fill="#FCDD07" opacity="0.9" />
      <path d="M10 12 L16 4 H48 L54 12 Z" fill="currentColor" />
      <rect x="19" y="6" width="10" height="6" rx="1" fill="#F9FAF6" opacity="0.85" />
      <rect x="31" y="6" width="10" height="6" rx="1" fill="#F9FAF6" opacity="0.85" />
      <circle cx="16" cy="31" r="6" fill="#121824" />
      <circle cx="16" cy="31" r="2.4" fill="#F9FAF6" />
      <circle cx="48" cy="31" r="6" fill="#121824" />
      <circle cx="48" cy="31" r="2.4" fill="#F9FAF6" />
      <circle cx="57" cy="18" r="1.4" fill="#FCDD07" />
    </svg>
  );
}
