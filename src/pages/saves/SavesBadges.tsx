import { Badge, type BadgeProps } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { SAVE_KIND_LABEL_KEY, SAVE_SOURCE_LABEL_KEY, type SaveBackupKind } from "../../types/saves";
import { protectionLabelKey, type ProtectionState } from "./savesData";

const KIND_VARIANT: Record<string, BadgeProps["variant"]> = {
  manual: "accent",
  "auto-exit": "info",
  "pre-restore": "warning",
};

const STATE_VARIANT: Record<ProtectionState, BadgeProps["variant"]> = {
  protected: "success",
  stale: "warning",
  never: "warning",
  missing: "danger",
  excluded: "default",
};

export function SnapshotKindBadge({ kind }: { kind: SaveBackupKind | string }) {
  const { t } = useLanguage();
  return (
    <Badge variant={KIND_VARIANT[kind] ?? "default"} size="sm">
      {t(SAVE_KIND_LABEL_KEY[kind] ?? "saves.kind.manual")}
    </Badge>
  );
}

export function SnapshotStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  if (status === "complete") return null;
  return (
    <Badge variant={status === "failed" ? "danger" : "warning"} size="sm" dot>
      {t(`saves.status.${status}`)}
    </Badge>
  );
}

export function ProtectionBadge({ state, title }: { state: ProtectionState; title?: string }) {
  const { t } = useLanguage();
  return (
    <Badge variant={STATE_VARIANT[state]} size="sm" dot title={title}>
      {t(protectionLabelKey(state))}
    </Badge>
  );
}

/** Legacy-friendly alias used by the per-game tab for location provenance. */
export function LocationSourceBadge({ source }: { source: string }) {
  const { t } = useLanguage();
  const variant: BadgeProps["variant"] =
    source === "curated"
      ? "accent"
      : source === "steam" || source === "pcgamingwiki"
        ? "info"
        : source === "emulator"
          ? "success"
          : "default";
  return (
    <Badge variant={variant} size="sm">
      {t(SAVE_SOURCE_LABEL_KEY[source] ?? "saves.source.manual")}
    </Badge>
  );
}
