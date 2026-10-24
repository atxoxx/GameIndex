import {
  Brain,
  Clock,
  Compass,
  Flame,
  Library,
  MoonStar,
  Sparkles,
  Timer,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { GamerPersona } from "./statsTypes";

/**
 * Persona and milestone glyphs. The persona/milestone data still carries
 * emoji fields for older payloads, but the UI now renders one crisp lucide
 * set so the stats cockpit matches the rest of the app's icon language.
 */
const PERSONA_ICONS: Record<string, LucideIcon> = {
  night_owl: MoonStar,
  rpg_voyager: Compass,
  master_tactician: Brain,
  marathon_runner: Timer,
  versatile_champion: Sparkles,
};

const MILESTONE_ICONS: Record<string, LucideIcon> = {
  playtime: Clock,
  library: Library,
  streak: Flame,
  achievements: Trophy,
};

export function PersonaIcon({
  persona,
  size = 30,
  className,
}: {
  persona: Pick<GamerPersona, "id">;
  size?: number;
  className?: string;
}) {
  const Icon = PERSONA_ICONS[persona.id] ?? Sparkles;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

export function MilestoneIcon({
  category,
  size = 18,
  className,
}: {
  category: string;
  size?: number;
  className?: string;
}) {
  const Icon = MILESTONE_ICONS[category] ?? Trophy;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
