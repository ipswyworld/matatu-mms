import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Node runtime, not edge: lets this read the crest straight off disk
// (public/icon-512.png) rather than needing a network round-trip to its
// own deployed URL just to render an image of itself.
export const runtime = "nodejs";

export const alt = "Matatu Management System — book, track, and pay in Nairobi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const crest = readFileSync(join(process.cwd(), "public/icon-512.png")).toString("base64");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0F5132",
          fontFamily: "sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${crest}`}
          width={140}
          height={140}
          alt=""
          style={{ borderRadius: 16 }}
        />
        <div
          style={{
            marginTop: 36,
            fontSize: 56,
            fontWeight: 800,
            color: "#FBF6E5",
            letterSpacing: "-0.02em",
          }}
        >
          Book, track, and pay
        </div>
        <div style={{ marginTop: 14, fontSize: 28, color: "#C7D9CC" }}>
          Nairobi City County — Matatu Management System
        </div>
      </div>
    ),
    { ...size }
  );
}
