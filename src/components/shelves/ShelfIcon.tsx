import {
  Bookmark,
  Clock,
  Flame,
  Gamepad2,
  Heart,
  Layers,
  Sparkles,
  Star,
  Timer,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { SHELF_ICONS, type ShelfIcon as ShelfIconName } from "../../types/shelf";

/** Lucide components addressable by the icon names a shelf may store. */
const ICON_MAP: Record<ShelfIconName, LucideIcon> = {
  layers: Layers,
  clock: Clock,
  zap: Zap,
  users: Users,
  trophy: Trophy,
  sparkles: Sparkles,
  heart: Heart,
  star: Star,
  "gamepad-2": Gamepad2,
  bookmark: Bookmark,
  flame: Flame,
  timer: Timer,
};

export interface ShelfIconProps {
  name: string;
  size?: number;
  className?: string;
}

/** Resolve a shelf's stored icon name to a Lucide component, defaulting to Layers. */
export function ShelfIcon({ name, size = 16, className }: ShelfIconProps) {
  const Icon = (SHELF_ICONS as readonly string[]).includes(name)
    ? ICON_MAP[name as ShelfIconName]
    : Layers;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

export default ShelfIcon;
