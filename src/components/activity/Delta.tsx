import type { Delta as DeltaValue } from "./insights";
import * as Icons from "./Icons";

export function Delta({ delta }: { delta?: DeltaValue | null }) {
  if (!delta) return null;
  const Icon = delta.direction === "up" ? Icons.TrendingUp : delta.direction === "down" ? Icons.TrendingDown : null;
  return (
    <span className={`act-delta act-delta--${delta.direction}`} aria-hidden="true">
      {Icon && <Icon size={11} />}
      {delta.pct}%
    </span>
  );
}
