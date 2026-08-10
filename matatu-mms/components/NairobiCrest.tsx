interface NairobiCrestProps {
  size?: number;
  className?: string;
}

/**
 * Stylized recreation of the Nairobi City County coat of arms: crowned
 * crested cranes flanking a shield (red flowers ringing a blue water drop),
 * a scroll ribbon beneath. Redrawn as SVG from the referenced artwork, not a
 * pixel-exact reproduction. Used anywhere the county needs a real identity
 * mark rather than a generic monogram (Sidebar, login page).
 */
export default function NairobiCrest({ size = 56, className = "" }: NairobiCrestProps) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={className} role="img" aria-label="Nairobi City County crest">
      {/* Outer green ring */}
      <circle cx="100" cy="100" r="96" fill="#045A20" />
      {/* Gold ring */}
      <circle cx="100" cy="100" r="88" fill="#FCDD07" />
      {/* White field */}
      <circle cx="100" cy="100" r="80" fill="#F9FAF6" />

      {/* Crested cranes, flanking the shield */}
      {[-1, 1].map((side) => (
        <g key={side} transform={`translate(${100 + side * 46}, 96) scale(${side}, 1)`}>
          {/* Body */}
          <path d="M0 28 C -10 24 -14 10 -8 -2 C -4 -10 4 -12 8 -6 C 14 2 12 20 4 28 Z" fill="#121824" />
          {/* Neck + head */}
          <path d="M4 -6 C 10 -16 16 -24 24 -30 C 27 -32 30 -30 28 -27 C 24 -21 20 -15 16 -8 Z" fill="#121824" />
          {/* Beak */}
          <path d="M24 -30 L 34 -33 L 25 -27 Z" fill="#CE1126" />
          {/* Crown */}
          <path d="M18 -27 L 20 -33 L 22 -28 L 24 -34 L 25 -28 L 27 -32 L 26 -25 Z" fill="#FCDD07" />
          {/* Leg */}
          <path d="M-2 26 L -3 40 M 2 27 L 3 40" stroke="#121824" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* Wing detail */}
          <path d="M-6 4 C -2 8 4 8 8 2" stroke="#F9FAF6" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.6" />
        </g>
      ))}

      {/* Shield */}
      <path
        d="M100 44 C 116 44 130 40 138 34 C 138 70 136 108 100 132 C 64 108 62 70 62 34 C 70 40 84 44 100 44 Z"
        fill="#068930"
        stroke="#121824"
        strokeWidth="2"
      />

      {/* Ring of red flowers around the water drop */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const r = 22;
        const cx = 100 + Math.cos(angle) * r;
        const cy = 88 + Math.sin(angle) * r;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r="5" fill="#CE1126" />
            <circle cx={cx} cy={cy} r="1.6" fill="#FCDD07" />
          </g>
        );
      })}

      {/* Blue water drop, centerpiece */}
      <path
        d="M100 74 C 108 86 114 94 114 102 C 114 111 107.7 118 100 118 C 92.3 118 86 111 86 102 C 86 94 92 86 100 74 Z"
        fill="#0F47AF"
      />

      {/* Scroll ribbon beneath the shield */}
      <path
        d="M58 140 C 72 134 128 134 142 140 L 136 150 C 122 146 78 146 64 150 Z"
        fill="#FCDD07"
        stroke="#121824"
        strokeWidth="1.5"
      />
    </svg>
  );
}
