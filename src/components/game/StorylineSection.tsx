import type { Game } from "../../types/game";
import { IconShield } from "./icons";
import { useLanguage } from "../../context/LanguageContext";
import { Panel } from "../ui/Panel";

/**
 * StorylineSection
 *
 *  Main-column "Storyline" card. Renders the IGDB storyline as a
 *  styled blockquote with a left accent bar. The full quote is
 *  italicized and de-emphasized (muted color) so it reads as
 *  flavor text rather than primary content.
 */

interface StorylineSectionProps {
  game: Game;
}

export default function StorylineSection({ game }: StorylineSectionProps) {
  const { t } = useLanguage();
  if (!game.storyline) return null;
  return (
    <Panel
      heading={t("edit.label.storyline")}
      icon={<IconShield size={16} />}
      className="storyline-section"
    >
      <blockquote className="storyline-quote">
        "{game.storyline}"
      </blockquote>
    </Panel>
  );
}
