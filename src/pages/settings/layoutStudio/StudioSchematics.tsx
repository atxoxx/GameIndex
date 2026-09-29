import type { ReactNode } from "react";
import {
  Activity,
  Check,
  Clock,
  Heart,
  Newspaper,
  Play,
  Search,
  Sparkles,
  Star,
} from "lucide-react";

/** Single grey placeholder line (label, text line, subtitle...). */
export function Line({ w, h }: { w: number; h?: number }) {
  return (
    <i
      className="studio-detail-line"
      style={{ width: `${w}%`, height: h ? `${h}px` : undefined }}
      aria-hidden="true"
    />
  );
}

/** Multiple stacked grey placeholder lines. */
export function Lines({ ws }: { ws: number[] }) {
  return (
    <span className="studio-detail-lines">
      {ws.map((w, i) => (
        <Line key={i} w={w} />
      ))}
    </span>
  );
}

/** A KPI tile sample: icon square + label / value bars, optional footer bar. */
export function MiniTile({
  label,
  value,
  icon: Icon,
  footer,
}: {
  label?: string;
  value?: string;
  icon?: typeof Activity;
  footer?: ReactNode;
}) {
  return (
    <span className="studio-detail-kpi">
      <span className="studio-detail-kpi__icon" aria-hidden="true">
        {Icon && <Icon size={11} strokeWidth={2} />}
      </span>
      <span className="studio-detail-kpi__text">
        {value ? (
          <span className="studio-schematic-kpi-val">{value}</span>
        ) : (
          <Line w={64} />
        )}
        {label ? (
          <span className="studio-schematic-kpi-lbl">{label}</span>
        ) : (
          <Line w={42} />
        )}
        {footer}
      </span>
    </span>
  );
}

/** A progress track with an accent fill (ratings breakdown, time to beat, download progress). */
export function Track({
  value,
  color,
  height,
}: {
  value: number;
  color?: string;
  height?: number;
}) {
  return (
    <span
      className="studio-detail-track"
      style={{ height: height ? `${height}px` : undefined }}
      aria-hidden="true"
    >
      <span
        className="studio-detail-track__fill"
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: color ?? undefined,
        }}
      />
    </span>
  );
}

/** Definition rows: label bar on the left, value bar on the right. */
export function MetaRows({
  count,
  label,
  value,
}: {
  count: number;
  label: number;
  value: number;
}) {
  return (
    <span className="studio-detail-rows">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="studio-detail-row">
          <Line w={label} />
          <Line w={value} />
        </span>
      ))}
    </span>
  );
}

/** Schematic search bar with icon and placeholder line. */
export function SchematicSearchBar({ placeholder = "Search..." }: { placeholder?: string }) {
  return (
    <div className="studio-schematic-search">
      <Search size={10} aria-hidden="true" className="studio-schematic-search__icon" />
      <span className="studio-schematic-search__text">{placeholder}</span>
    </div>
  );
}

/** Schematic horizontal card rail (Continue Playing, Recently Added, Wishlist, Deals, News). */
export function SchematicCardRail({
  variant = "standard",
  count = 4,
}: {
  variant?: "standard" | "progress" | "sale" | "news" | "compact";
  count?: number;
}) {
  return (
    <div className="studio-schematic-rail">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`studio-schematic-card studio-schematic-card--${variant}`}>
          <div className="studio-schematic-card__cover">
            {variant === "progress" && (
              <span className="studio-schematic-card__play">
                <Play size={8} fill="currentColor" />
              </span>
            )}
            {variant === "sale" && (
              <span className="studio-schematic-card__badge studio-schematic-card__badge--sale">
                {i === 0 ? "-75%" : i === 1 ? "-50%" : "-33%"}
              </span>
            )}
            {variant === "news" && (
              <span className="studio-schematic-card__badge studio-schematic-card__badge--news">
                <Newspaper size={7} />
              </span>
            )}
          </div>
          <div className="studio-schematic-card__meta">
            <Line w={75} />
            {variant === "progress" ? (
              <Track value={60 - i * 15} />
            ) : variant === "sale" ? (
              <span className="studio-schematic-card__prices">
                <Line w={30} />
                <Line w={40} />
              </span>
            ) : (
              <Line w={45} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Schematic Grid of Game Cards (Library grid, Store grid, Wishlist grid). */
export function SchematicGameGrid({
  variant = "library",
  columns = 4,
  rows = 2,
}: {
  variant?: "library" | "store" | "wishlist";
  columns?: number;
  rows?: number;
}) {
  const total = columns * rows;
  return (
    <div
      className={`studio-schematic-grid studio-schematic-grid--${variant}`}
      style={{ "--grid-cols": columns } as React.CSSProperties}
    >
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="studio-schematic-grid-item">
          <div className="studio-schematic-grid-item__cover">
            {variant === "store" && i % 2 === 0 && (
              <span className="studio-schematic-card__badge studio-schematic-card__badge--sale">
                -{40 + (i % 3) * 20}%
              </span>
            )}
            {variant === "wishlist" && (
              <span className="studio-schematic-card__badge studio-schematic-card__badge--heart">
                <Heart size={7} fill="currentColor" />
              </span>
            )}
            {variant === "library" && i % 3 === 0 && (
              <span className="studio-schematic-card__badge studio-schematic-card__badge--installed">
                <Check size={7} />
              </span>
            )}
          </div>
          <div className="studio-schematic-grid-item__meta">
            <Line w={80} />
            <div className="studio-schematic-grid-item__sub">
              {variant === "store" ? (
                <>
                  <Line w={35} />
                  <span className="studio-schematic-rating">
                    <Star size={7} fill="currentColor" /> 92%
                  </span>
                </>
              ) : variant === "wishlist" ? (
                <>
                  <Line w={40} />
                  <Line w={30} />
                </>
              ) : (
                <>
                  <Line w={45} />
                  <span className="studio-schematic-playtime">
                    <Clock size={7} /> 24h
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Schematic Filter Chips row. */
export function SchematicFilterChips({ chips }: { chips: string[] }) {
  return (
    <div className="studio-schematic-chips">
      {chips.map((chip, i) => (
        <span key={i} className="studio-schematic-chip">
          <span>{chip}</span>
          <i className="studio-schematic-chip__x">×</i>
        </span>
      ))}
      <span className="studio-schematic-chip studio-schematic-chip--reset">Reset</span>
    </div>
  );
}

/** Schematic Segmented Tabs. */
export function SchematicSegmentedTabs({
  tabs,
  activeIndex = 0,
}: {
  tabs: string[];
  activeIndex?: number;
}) {
  return (
    <div className="studio-schematic-tabs">
      {tabs.map((tab, i) => (
        <span
          key={i}
          className={`studio-schematic-tab${i === activeIndex ? " is-active" : ""}`}
        >
          {tab}
        </span>
      ))}
    </div>
  );
}

/** Schematic Spotlight Hero banner for Home, Library, Store. */
export function SchematicHero({
  title,
  badgeText,
  variant = "home",
}: {
  title?: ReactNode;
  badgeText?: string;
  variant?: "home" | "library" | "store";
}) {
  return (
    <div className={`studio-schematic-hero studio-schematic-hero--${variant}`}>
      <div className="studio-schematic-hero__backdrop" />
      <div className="studio-schematic-hero__content">
        <div className="studio-schematic-hero__badge">
          <Sparkles size={9} aria-hidden="true" />
          <span>{badgeText ?? (variant === "store" ? "Featured Showcase" : "Spotlight")}</span>
        </div>
        <div className="studio-schematic-hero__title">
          {title ?? (
            <>
              <Line w={48} h={14} />
              <Line w={32} h={10} />
            </>
          )}
        </div>
        <div className="studio-schematic-hero__actions">
          <span className="studio-schematic-hero__btn studio-schematic-hero__btn--primary">
            <Play size={9} fill="currentColor" />
            <span>{variant === "store" ? "View Store" : "Play Game"}</span>
          </span>
          <span className="studio-schematic-hero__btn">
            <span>Details</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Schematic Sparkline bar wave. */
export function SchematicSparkline({
  height = 28,
  bars = [20, 45, 30, 60, 40, 85, 55, 95, 70, 80, 65, 90, 75, 100],
  color = "var(--color-accent)",
}: {
  height?: number;
  bars?: number[];
  color?: string;
}) {
  return (
    <div className="studio-schematic-sparkline" style={{ height: `${height}px` }} aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className="studio-schematic-sparkline__bar"
          style={{ height: `${h}%`, backgroundColor: color }}
        />
      ))}
    </div>
  );
}

/** Schematic Donut chart representation. */
export function SchematicDonut({
  size = 56,
  stroke = 7,
}: {
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="studio-schematic-donut" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={stroke}
        strokeDasharray={`${c * 0.45} ${c * 0.55}`}
        strokeDashoffset={c * 0.25}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-brand-cyan, #06b6d4)"
        strokeWidth={stroke}
        strokeDasharray={`${c * 0.3} ${c * 0.7}`}
        strokeDashoffset={-c * 0.2}
      />
    </svg>
  );
}

/** Schematic Disk Meter: drive letter, label, space, and a track. */
export function SchematicDiskMeter({
  drive,
  label,
  used,
  total,
  percent,
}: {
  drive: string;
  label: string;
  used: string;
  total: string;
  percent: number;
}) {
  return (
    <div className="studio-schematic-disk">
      <div className="studio-schematic-disk__head">
        <span className="studio-schematic-disk__drive">{drive}</span>
        <span className="studio-schematic-disk__label">{label}</span>
        <span className="studio-schematic-disk__space">
          {used} / {total}
        </span>
      </div>
      <Track value={percent} />
    </div>
  );
}

