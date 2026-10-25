import { Film } from "lucide-react";
import { UrlListEditor } from "../../UrlListEditor";
import { SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function VideosSection() {
  const {
    t,
    editVideos,
    setEditVideos,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-videos">
      <SectionHeader
        id="edit-section-videos"
        title={t("edit.section.videos")}
        description={t("edit.section.videosDesc")}
        changed={dirtyBySection.videos}
        onReset={() => resetSection("videos")}
      />

      <div id="edit-videos" className="edit-media-editor">
        <UrlListEditor
          title={t("editExtras.videosTrailers")}
          items={editVideos}
          onChange={setEditVideos}
          placeholder={t("edit.videos.placeholder")}
          emptyText={t("edit.videos.empty")}
          thumbnail={(url: string) => {
            const videoId = url.match(
              /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/,
            )?.[1];
            return videoId
              ? `https://img.youtube.com/vi/${videoId}/default.jpg`
              : undefined;
          }}
        />
      </div>

      <p className="edit-muted-note edit-media-note">
        <Film size={14} aria-hidden="true" />
        {t("edit.videos.hint")}
      </p>
    </section>
  );
}
