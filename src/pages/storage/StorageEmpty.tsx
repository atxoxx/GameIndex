import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

/** The page's single empty-state treatment — tonal, no border, icon in a
 *  tinted tile. Used by the table, the overview and the emulator list so they
 *  read as one pattern. */
export function StorageEmpty({ icon, title, description, action, compact = false }: Props) {
  return (
    <div className={`storage-empty${compact ? " storage-empty--compact" : ""}`}>
      <span className="storage-empty__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="storage-empty__title">{title}</p>
      {description && <p className="storage-empty__desc">{description}</p>}
      {action && <div className="storage-empty__action">{action}</div>}
    </div>
  );
}
