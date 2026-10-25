import { Image as ImageIcon } from "lucide-react";
import { UrlListEditor } from "../../UrlListEditor";
import { SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function ScreenshotsSection() {
  const {
    t,
    editScreenshots,
    setEditScreenshots,
    fetchingImageKey,
    handleApplyIgdbImage,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-screenshots">
      <SectionHeader
        id="edit-section-screenshots"
        title={t("edit.section.screenshots")}
        description={t("edit.section.screenshotsDesc")}
        changed={dirtyBySection.screenshots}
        onReset={() => resetSection("screenshots")}
      />

      <div id="edit-screenshots" className="edit-media-editor">
        <UrlListEditor
          title={t("editExtras.screenshots")}
          items={editScreenshots}
          onChange={setEditScreenshots}
          placeholder={t("edit.screenshots.placeholder")}
          emptyText={t("edit.screenshots.empty")}
          primaryActions={(url: string) => (
            <>
              <button
                type="button"
                className="lb-apply-btn"
                onClick={() => handleApplyIgdbImage(url, "cover")}
                disabled={fetchingImageKey !== null}
              >
                {t("edit.setAsCover")}
              </button>
              <button
                type="button"
                className="lb-apply-btn"
                onClick={() => handleApplyIgdbImage(url, "hero")}
                disabled={fetchingImageKey !== null}
              >
                {t("edit.setAsHero")}
              </button>
            </>
          )}
        />
      </div>

      <p className="edit-muted-note edit-media-note">
        <ImageIcon size={14} aria-hidden="true" />
        {t("edit.screenshots.hint")}
      </p>
    </section>
  );
}
