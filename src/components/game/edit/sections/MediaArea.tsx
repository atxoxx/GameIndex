import type { EditSectionKey } from "../draftKeys";
import { ArtworkSection } from "./ArtworkSection";
import { ScreenshotsSection } from "./ScreenshotsSection";
import { VideosSection } from "./VideosSection";
import { LinksSection } from "./LinksSection";

export function MediaArea({ section }: { section: EditSectionKey }) {
  return (
    <div className="edit-area">
      {section === "artwork" && <ArtworkSection />}
      {section === "screenshots" && <ScreenshotsSection />}
      {section === "videos" && <VideosSection />}
      {section === "links" && <LinksSection />}
    </div>
  );
}
