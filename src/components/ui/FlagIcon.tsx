import React from "react";

/**
 * FlagIcon
 *
 *  Renders a country flag as an inline SVG (3:2 aspect, 24×16 viewBox).
 *
 *  Why not emoji? Windows ships no flag glyphs in Segoe UI Emoji, so
 *  regional-indicator pairs like 🇬🇧 render as bare "GB" letters on
 *  Windows 10/11 (and many Linux font stacks). Inline SVGs render
 *  identically on every platform, which is what the language picker,
 *  the About-section switcher, and the Steam reviews filter need.
 *
 *  The art is simplified — tricolors, crosses, and the handful of
 *  emblem flags (UK, CN, TW, KR, BR, …) are drawn as flat shapes with
 *  the official-ish palette. Flags are fixed brand colours, not theme
 *  tokens, so hex literals are intentional here. Unknown codes fall
 *  back to a neutral globe glyph (also used for the "All languages"
 *  option in the Steam reviews filter).
 */

export interface FlagIconProps {
  /** Lowercase ISO 3166-1 alpha-2 country code (e.g. "gb", "fr") or
   *  "globe" for the generic-language glyph. */
  code: string;
  /** Render width in px; height derives from the 3:2 ratio. */
  size?: number;
  className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Point list for an upright 5-point star centred at (cx, cy). */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** Rotation (deg) that points a star's top vertex from `from` toward `to`. */
function angleTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return (Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI + 90;
}

/** One of the four Korean trigram blocks: three bars, each solid or broken. */
function Trigram({
  x,
  y,
  pattern,
}: {
  x: number;
  y: number;
  pattern: [boolean, boolean, boolean];
}) {
  const BAR_W = 5;
  const BAR_H = 0.65;
  const STEP = 1.2;
  return (
    <g fill="#000">
      {pattern.map((solid, i) => {
        const by = y - 1.2 + i * STEP;
        if (solid) {
          return <rect key={i} x={x - BAR_W / 2} y={by} width={BAR_W} height={BAR_H} />;
        }
        return (
          <g key={i}>
            <rect x={x - BAR_W / 2} y={by} width={2.2} height={BAR_H} />
            <rect x={x + 0.3} y={by} width={2.2} height={BAR_H} />
          </g>
        );
      })}
    </g>
  );
}

// ─── Flag art ───────────────────────────────────────────────────────────────

const GLOBE = (
  <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="12" cy="8" r="6.2" />
    <ellipse cx="12" cy="8" rx="2.4" ry="6.2" strokeWidth="1" />
    <line x1="5.8" y1="8" x2="18.2" y2="8" strokeWidth="1" />
  </g>
);

const FLAGS: Record<string, React.ReactNode> = {
  // Generic "all languages" glyph (Steam reviews language filter).
  globe: GLOBE,
  all: GLOBE,

  // UK — Union Jack (white/red diagonals under the St George cross).
  gb: (
    <>
      <rect width="24" height="16" fill="#012169" />
      <path d="M-2 -2 L26 18 M26 -2 L-2 18" stroke="#fff" strokeWidth="6" />
      <path d="M-2 -2 L26 18 M26 -2 L-2 18" stroke="#C8102E" strokeWidth="3" />
      <path d="M12 -2 V18 M-2 8 H26" stroke="#fff" strokeWidth="5.5" />
      <path d="M12 -2 V18 M-2 8 H26" stroke="#C8102E" strokeWidth="2.8" />
    </>
  ),

  // France — blue / white / red vertical.
  fr: (
    <>
      <rect width="8" height="16" fill="#0055A4" />
      <rect x="8" width="8" height="16" fill="#fff" />
      <rect x="16" width="8" height="16" fill="#EF4135" />
    </>
  ),

  // Spain — red / yellow (double) / red.
  es: (
    <>
      <rect width="24" height="4" fill="#AA151B" />
      <rect y="4" width="24" height="8" fill="#F1BF00" />
      <rect y="12" width="24" height="4" fill="#AA151B" />
    </>
  ),

  // Germany — black / red / gold.
  de: (
    <>
      <rect width="24" height="5.34" fill="#000" />
      <rect y="5.34" width="24" height="5.33" fill="#DD0000" />
      <rect y="10.67" width="24" height="5.33" fill="#FFCE00" />
    </>
  ),

  // Russia — white / blue / red.
  ru: (
    <>
      <rect width="24" height="5.34" fill="#fff" />
      <rect y="5.34" width="24" height="5.33" fill="#0039A6" />
      <rect y="10.67" width="24" height="5.33" fill="#D52B1E" />
    </>
  ),

  // China — red field, one big + four small yellow stars angled to it.
  cn: (
    <>
      <rect width="24" height="16" fill="#DE2910" />
      <polygon points={starPoints(6, 5.5, 3.4, 1.36)} fill="#FFDE00" />
      {(
        [
          [10.3, 2.6],
          [12.1, 4.6],
          [11.7, 7.2],
          [10.1, 8.2],
        ] as const
      ).map(([sx, sy]) => (
        <g key={`${sx}-${sy}`} transform={`rotate(${angleTo(sx, sy, 6, 5.5)} ${sx} ${sy})`}>
          <polygon points={starPoints(sx, sy, 1.3, 0.52)} fill="#FFDE00" />
        </g>
      ))}
    </>
  ),

  // Taiwan — red field, blue canton with a white 12-ray sun.
  tw: (
    <>
      <rect width="24" height="16" fill="#FE0000" />
      <rect width="6" height="8" fill="#000095" />
      <circle cx="3" cy="4" r="1.5" fill="#fff" />
      {Array.from({ length: 12 }).map((_, i) => (
        <rect
          key={i}
          x="2.65"
          y="1.05"
          width="0.7"
          height="1.45"
          fill="#fff"
          transform={`rotate(${i * 30} 3 4)`}
        />
      ))}
    </>
  ),

  // Japan — white field, red disc.
  jp: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <circle cx="12" cy="8" r="4.6" fill="#BC002D" />
    </>
  ),

  // South Korea — white field, taegeuk + four trigrams.
  kr: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <path d="M12 8 A4 4 0 0 1 20 8 A4 4 0 0 0 12 8 Z" fill="#CD2E3A" />
      <path d="M12 8 A4 4 0 0 0 4 8 A4 4 0 0 1 12 8 Z" fill="#0047A0" />
      <circle cx="14.4" cy="8" r="1.05" fill="#0047A0" />
      <circle cx="9.6" cy="8" r="1.05" fill="#CD2E3A" />
      <Trigram x={3.5} y={3.5} pattern={[true, true, true]} />
      <Trigram x={20.5} y={3.5} pattern={[true, false, true]} />
      <Trigram x={3.5} y={12.5} pattern={[false, false, false]} />
      <Trigram x={20.5} y={12.5} pattern={[false, true, false]} />
    </>
  ),

  // Ukraine — blue / yellow horizontal.
  ua: (
    <>
      <rect width="24" height="8" fill="#005BBB" />
      <rect y="8" width="24" height="8" fill="#FFD500" />
    </>
  ),

  // Italy — green / white / red vertical.
  it: (
    <>
      <rect width="8" height="16" fill="#009246" />
      <rect x="8" width="8" height="16" fill="#fff" />
      <rect x="16" width="8" height="16" fill="#CE2B37" />
    </>
  ),

  // Mexico — green / white / red + eagle mark (distinguishes from Italy).
  mx: (
    <>
      <rect width="8" height="16" fill="#006847" />
      <rect x="8" width="8" height="16" fill="#fff" />
      <rect x="16" width="8" height="16" fill="#CE1126" />
      <circle cx="12" cy="8" r="1.3" fill="#7A4A21" />
    </>
  ),

  // Portugal — green / red field with a golden armillary sphere.
  pt: (
    <>
      <rect width="9.6" height="16" fill="#046A38" />
      <rect x="9.6" width="14.4" height="16" fill="#DA291C" />
      <circle cx="9.6" cy="8" r="3.2" fill="#FFD700" />
      <circle cx="9.6" cy="8" r="0.95" fill="#fff" />
      <rect x="7.4" y="7.8" width="4.4" height="0.4" fill="#DA291C" />
    </>
  ),

  // Brazil — green field, yellow diamond, blue disc with white band.
  br: (
    <>
      <rect width="24" height="16" fill="#009739" />
      <polygon points="12,1.5 22.5,8 12,14.5 1.5,8" fill="#FEDD00" />
      <circle cx="12" cy="8" r="4.1" fill="#002776" />
      <rect x="9.2" y="7.6" width="5.6" height="0.8" fill="#fff" />
    </>
  ),

  // Poland — white / red.
  pl: (
    <>
      <rect width="24" height="8" fill="#fff" />
      <rect y="8" width="24" height="8" fill="#DC143C" />
    </>
  ),

  // Czechia — white / red with a blue hoist triangle.
  cz: (
    <>
      <rect width="24" height="8" fill="#fff" />
      <rect y="8" width="24" height="8" fill="#D7141A" />
      <polygon points="0,0 8.5,8 0,16" fill="#11457E" />
    </>
  ),

  // Hungary — red / white / green.
  hu: (
    <>
      <rect width="24" height="5.34" fill="#CD2A3E" />
      <rect y="5.34" width="24" height="5.33" fill="#fff" />
      <rect y="10.67" width="24" height="5.33" fill="#436F4D" />
    </>
  ),

  // Romania — blue / yellow / red vertical.
  ro: (
    <>
      <rect width="8" height="16" fill="#002B7F" />
      <rect x="8" width="8" height="16" fill="#FCD116" />
      <rect x="16" width="8" height="16" fill="#CE1126" />
    </>
  ),

  // Bulgaria — white / green / red.
  bg: (
    <>
      <rect width="24" height="5.34" fill="#fff" />
      <rect y="5.34" width="24" height="5.33" fill="#00966E" />
      <rect y="10.67" width="24" height="5.33" fill="#D62612" />
    </>
  ),

  // Greece — blue/white stripes with a white cross canton.
  gr: (
    <>
      <rect width="24" height="16" fill="#fff" />
      {[0, 3.6, 7.2, 10.8, 14.4].map((y) => (
        <rect key={y} y={y} width="24" height="1.8" fill="#0D5EAF" />
      ))}
      <rect width="8" height="8" fill="#0D5EAF" />
      <rect x="3.6" width="0.8" height="8" fill="#fff" />
      <rect y="3.6" width="8" height="0.8" fill="#fff" />
    </>
  ),

  // Turkey — red field, white crescent + star.
  tr: (
    <>
      <rect width="24" height="16" fill="#E30A17" />
      <circle cx="10" cy="8" r="4.6" fill="#fff" />
      <circle cx="11.4" cy="8" r="3.8" fill="#E30A17" />
      <polygon points={starPoints(14, 8, 1.9, 0.76)} fill="#fff" />
    </>
  ),

  // Thailand — red / white / blue / white / red stripes.
  th: (
    <>
      <rect width="24" height="3" fill="#A51931" />
      <rect y="3" width="24" height="1.4" fill="#F4F5F8" />
      <rect y="4.4" width="24" height="7.2" fill="#2D2A4A" />
      <rect y="11.6" width="24" height="1.4" fill="#F4F5F8" />
      <rect y="13" width="24" height="3" fill="#A51931" />
    </>
  ),

  // Vietnam — red field, yellow star.
  vn: (
    <>
      <rect width="24" height="16" fill="#DA251D" />
      <polygon points={starPoints(12, 8, 4.8, 1.92)} fill="#FFFF00" />
    </>
  ),

  // Indonesia — red / white.
  id: (
    <>
      <rect width="24" height="8" fill="#CE1126" />
      <rect y="8" width="24" height="8" fill="#fff" />
    </>
  ),

  // Finland — white field, blue Nordic cross.
  fi: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="6.8" width="24" height="2.4" fill="#002F6C" />
      <rect x="10.8" width="2.4" height="16" fill="#002F6C" />
    </>
  ),

  // Sweden — blue field, yellow Nordic cross.
  se: (
    <>
      <rect width="24" height="16" fill="#006AA7" />
      <rect y="6.8" width="24" height="2.4" fill="#FECC00" />
      <rect x="10.8" width="2.4" height="16" fill="#FECC00" />
    </>
  ),

  // Denmark — red field, white Nordic cross.
  dk: (
    <>
      <rect width="24" height="16" fill="#C60C30" />
      <rect y="6.8" width="24" height="2.4" fill="#fff" />
      <rect x="10.8" width="2.4" height="16" fill="#fff" />
    </>
  ),

  // Norway — red field, white-edged blue Nordic cross.
  no: (
    <>
      <rect width="24" height="16" fill="#BA0C2F" />
      <rect y="6.5" width="24" height="3" fill="#fff" />
      <rect x="10.5" width="3" height="16" fill="#fff" />
      <rect y="7.2" width="24" height="1.6" fill="#00205B" />
      <rect x="10.9" width="1.6" height="16" fill="#00205B" />
    </>
  ),

  // Netherlands — red / white / blue.
  nl: (
    <>
      <rect width="24" height="5.34" fill="#AE1C28" />
      <rect y="5.34" width="24" height="5.33" fill="#fff" />
      <rect y="10.67" width="24" height="5.33" fill="#21468B" />
    </>
  ),
};

export default function FlagIcon({ code, size = 20, className }: FlagIconProps) {
  const key = (code ?? "").toLowerCase();
  const node = FLAGS[key] ?? GLOBE;
  return (
    <svg
      className={`flag-icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 16"
      width={size}
      height={Math.round((size * 16 * 100) / 24) / 100}
      aria-hidden="true"
      focusable="false"
    >
      {node}
    </svg>
  );
}
