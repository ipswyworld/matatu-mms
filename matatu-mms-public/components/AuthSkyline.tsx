interface AuthSkylineProps {
  /** Tailwind height utility for the skyline band. Defaults to matching AuthPageShell. */
  heightClassName?: string;
}

/**
 * Nairobi skyline, bottom-anchored and mask-faded into the cream background
 * so it reads as a watermark rather than a hard-edged photo. Shared across
 * every cream-background auth page (AuthPageShell, register, forgot/reset
 * password) so the identity is consistent, not just the front door.
 *
 * The image layer plus a county-green overlay on `mix-blend-mode: color`
 * retints the source art to the exact brand green (rather than whatever
 * green shade the source asset happened to ship with), while the overlay's
 * blend mode preserves the artwork's own line/background luminance so the
 * illustration doesn't flatten into a solid color block.
 *
 * Fully static by design (no animation, no transition, no parallax) — it's
 * a brand watermark, not a hero graphic; it should never draw the eye away
 * from the form.
 */
export default function AuthSkyline({ heightClassName = "h-[42%]" }: AuthSkylineProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 bottom-0 ${heightClassName} overflow-hidden`}
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0%, black 28%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 28%)",
        animation: "none",
        transition: "none",
      }}
    >
      <div
        className="absolute inset-0 opacity-80"
        style={{
          backgroundImage: "url(/nairobi-skyline.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "bottom",
          backgroundRepeat: "no-repeat",
        }}
      />
      <div className="absolute inset-0 bg-county-green" style={{ mixBlendMode: "color", opacity: 0.6 }} />
    </div>
  );
}
