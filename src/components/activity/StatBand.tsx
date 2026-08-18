import type { HTMLAttributes, ReactNode } from "react";
import { Delta } from "./Delta";
import type { Delta as DeltaValue } from "./insights";

export function StatBand({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`act-stats ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function StatCell({
  icon,
  label,
  value,
  sub,
  delta,
  hero = false,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: DeltaValue | null;
  hero?: boolean;
}) {
  return (
    <div className={`act-stat${hero ? " act-stat--hero" : ""}`}>
      {icon && (
        <span className="act-stat__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="act-stat__body">
        <span className="act-stat__label">{label}</span>
        <div className="act-stat__value-row">
          <span className="act-stat__value">{value}</span>
          <Delta delta={delta} />
        </div>
        {sub && <span className="act-stat__sub">{sub}</span>}
      </div>
    </div>
  );
}
