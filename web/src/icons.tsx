import type { SVGProps } from "react";

/** Minimal 24px stroke icon set (1.8px, round caps). */
const PATHS: Record<string, string[]> = {
  home: ["M3.5 10.5 12 4l8.5 6.5", "M5.5 9v10.5h13V9", "M10 19.5v-5h4v5"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  checkCircle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8 12.3l2.7 2.7L16.2 9.5"],
  x: ["M6 6l12 12", "M18 6 6 18"],
  xCircle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 9l6 6", "M15 9l-6 6"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5V12l3 2"],
  audit: ["M8 6h11", "M8 12h11", "M8 18h11", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  shield: ["M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3Z", "M9 12l2 2 4-4"],
  approvals: ["M9 11l3 3 8-8", "M20 12v6.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H15"],
  tap: ["M8.5 8.5a5 5 0 0 1 0 7", "M12 6a8.5 8.5 0 0 1 0 12", "M15.5 3.5a12 12 0 0 1 0 17", "M5 11v2"],
  snow: ["M12 3v18", "M4.2 7.5l15.6 9", "M4.2 16.5l15.6-9", "M9.5 4.5 12 7l2.5-2.5", "M9.5 19.5 12 17l2.5 2.5"],
  inbox: ["M4 13.5 6.5 5h11l2.5 8.5", "M4 13.5V19h16v-5.5h-5a3 3 0 0 1-6 0H4Z"],
  sparkle: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z", "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"],
  switch: ["M7 7h11l-3-3", "M17 17H6l3 3"],
  chevronRight: ["M9.5 6l6 6-6 6"],
  chevronDown: ["M6 9.5l6 6 6-6"],
  arrowLeft: ["M19 12H5", "M11 6l-6 6 6 6"],
  bolt: ["M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"],
  lock: ["M6.5 10.5h11v9.5h-11z", "M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
  card: ["M3.5 6.5h17v11h-17z", "M3.5 10h17", "M7 14.5h3"],
  // categories
  software: ["M8 8l-4 4 4 4", "M16 8l4 4-4 4", "M13.5 5.5l-3 13"],
  hardware: ["M3.5 5h17v11h-17z", "M9 20h6", "M12 16v4"],
  travel: ["M10.5 13.5 4 11l1.5-1.5 7 1 4-4.5c.8-.8 2.2-.8 3 0s.8 2.2 0 3l-4.5 4 1 7L15.5 21.5 13 15", "M7 17l-3 .5"],
  lodging: ["M3.5 19V6", "M3.5 15h17V19", "M20.5 15v-3.5a3 3 0 0 0-3-3H11v6.5", "M7 11.5h.01"],
  transport: ["M5 16.5V12l2-5h10l2 5v4.5", "M3.5 16.5h17v-4.5h-17z", "M7 19.5v-3", "M17 19.5v-3", "M7 14h.01", "M17 14h.01"],
  meals: ["M7 3v8", "M4.5 3v5a2.5 2.5 0 0 0 5 0V3", "M7 11v10", "M17 21V3c-2 1.5-3 4-3 7v3h3"],
  books: ["M5 4.5h5a2 2 0 0 1 2 2V20a1.5 1.5 0 0 0-1.5-1.5H5z", "M19 4.5h-5a2 2 0 0 0-2 2V20a1.5 1.5 0 0 1 1.5-1.5H19z"],
  gifts: ["M4 9h16v4H4z", "M5.5 13h13v7.5h-13z", "M12 9v11.5", "M12 9C10.5 5 7 5 7 7s3 2 5 2c2 0 5 0 5-2s-3.5-2-5 2"],
  gambling: ["M4.5 4.5h15v15h-15z", "M9 9h.01", "M15 15h.01", "M15 9h.01", "M9 15h.01", "M12 12h.01"],
  jewelry: ["M6.5 4h11L21 9l-9 11L3 9l3.5-5Z", "M3 9h18", "M9.5 4 12 9l2.5-5", "M12 9v11"],
  cash: ["M3 6.5h18v11H3z", "M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", "M6 9.5v5", "M18 9.5v5"],
  other: ["M6 3.5h12v17l-3-2-3 2-3-2-3 2z", "M9 8h6", "M9 12h6"],
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, strokeWidth = 1.8, ...rest }: { name: IconName | string; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  const paths = PATHS[name] ?? PATHS.other;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Small brand mark: three slanted glass bars forming an abstract "C". */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g transform="skewX(-10) translate(5 0)">
        <rect x="3" y="4" width="7" height="24" rx="3.5" fill="var(--brand)" />
        <rect x="12" y="4" width="7" height="9" rx="3.5" fill="var(--brand)" opacity="0.7" />
        <rect x="12" y="19" width="7" height="9" rx="3.5" fill="var(--brand)" opacity="0.7" />
        <rect x="21" y="4" width="6" height="7" rx="3" fill="var(--brand)" opacity="0.4" />
        <rect x="21" y="21" width="6" height="7" rx="3" fill="var(--brand)" opacity="0.4" />
      </g>
    </svg>
  );
}

/** Hero brand graphic: tall frosted slanted bars forming a big "C", fading to white at the top. */
export function GlassLetterform() {
  // columns: [x, segments [y, h]]
  const H = 340;
  const cols: [number, [number, number][]][] = [
    [40, [[40, 280]]],
    [100, [[20, 300]]],
    [160, [[10, 110], [230, 110]]],
    [220, [[20, 96], [234, 96]]],
    [280, [[40, 76], [244, 76]]],
  ];
  return (
    <svg className="letterform" viewBox={`0 0 380 ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id="lf-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--bar-top)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--bar-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--bar-bottom)" }} />
        </linearGradient>
        <linearGradient id="lf-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--bar-edge)" }} />
          <stop offset="1" style={{ stopColor: "var(--bar-edge)", stopOpacity: 0.2 }} />
        </linearGradient>
        <linearGradient id="lf-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.25" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="lf-mask"><rect width="380" height={H} fill="url(#lf-fade)" /></mask>
        <filter id="lf-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28" /></filter>
      </defs>
      <ellipse cx="190" cy="230" rx="150" ry="90" style={{ fill: "var(--bloom)" }} filter="url(#lf-blur)" />
      <g mask="url(#lf-mask)" transform="skewX(-12) translate(60 0)">
        {cols.map(([x, segs]) => segs.map(([y, h], i) => (
          <rect key={`${x}-${i}`} x={x} y={y} width="50" height={h} rx="25"
            fill="url(#lf-bar)" stroke="url(#lf-edge)" strokeWidth="1.5" />
        )))}
      </g>
    </svg>
  );
}
