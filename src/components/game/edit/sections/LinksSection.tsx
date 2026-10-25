import { Link as LinkIcon } from "lucide-react";
import { UrlListEditor } from "../../UrlListEditor";
import { SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function LinksSection() {
  const {
    t,
    editWebsites,
    setEditWebsites,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-links">
      <SectionHeader
        id="edit-section-links"
        title={t("edit.section.links")}
        description={t("edit.section.linksDesc")}
        changed={dirtyBySection.links}
        onReset={() => resetSection("links")}
      />

      <div id="edit-websites" className="edit-media-editor">
        <UrlListEditor
          title={t("editExtras.websites")}
          items={editWebsites}
          onChange={setEditWebsites}
          placeholder={t("edit.links.placeholder")}
          emptyText={t("edit.links.empty")}
        />
      </div>

      <p className="edit-muted-note edit-media-note">
        <LinkIcon size={14} aria-hidden="true" />
        {t("edit.links.hint")}
      </p>
    </section>
  );
}
