import type { VrModKind } from "../../../types/vrMod";
import type { PortTone } from "../portFormat";

/** Colour bucket for a VR mod kind, reusing the Ports chip tones. */
export function vrKindTone(kind: VrModKind): PortTone {
  switch (kind) {
    case "dedicated":
      return "accent";
    case "uevr":
      return "info";
    case "conversion":
      return "warning";
    default:
      return "default";
  }
}

export function vrKindLabelKey(kind: VrModKind): string {
  switch (kind) {
    case "dedicated":
      return "ports.vrMods.kind.dedicated";
    case "uevr":
      return "ports.vrMods.kind.uevr";
    case "conversion":
      return "ports.vrMods.kind.conversion";
    default:
      return "ports.vrMods.kind.unknown";
  }
}

export function formatVrDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
