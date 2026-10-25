import type { EditSectionKey } from "../draftKeys";
import { IdentitySection } from "./IdentitySection";
import { StorageSection } from "./StorageSection";
import { TagsSection } from "./TagsSection";
import { RatingsSection } from "./RatingsSection";
import { CatalogSection } from "./CatalogSection";

export function DetailsArea({ section }: { section: EditSectionKey }) {
  return (
    <div className="edit-area">
      {section === "identity" && <IdentitySection />}
      {section === "storage" && <StorageSection />}
      {section === "tags" && <TagsSection />}
      {section === "ratings" && <RatingsSection />}
      {section === "catalog" && <CatalogSection />}
    </div>
  );
}
