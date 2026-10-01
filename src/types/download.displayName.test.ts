import { describe, expect, it } from "vitest";
import {
  PENDING_METADATA_NAME,
  getDownloadDisplayName,
  type DownloadStatus,
  type TorrentDownload,
} from "./download";

const t = (key: string) =>
  key === "download.status.fetchingMetadata" ? "Récupération des métadonnées" : key;

function download(name: string, status: DownloadStatus): Pick<TorrentDownload, "name" | "status"> {
  return { name, status };
}

describe("getDownloadDisplayName", () => {
  it("replaces the engine's English placeholder with the localized label", () => {
    expect(
      getDownloadDisplayName(download(PENDING_METADATA_NAME, { kind: "fetchingMetadata" }), t),
    ).toBe("Récupération des métadonnées");
  });

  it("prefers a matched game name over the localized placeholder", () => {
    expect(
      getDownloadDisplayName(
        download(PENDING_METADATA_NAME, { kind: "fetchingMetadata" }),
        t,
        "Black Mesa",
      ),
    ).toBe("Black Mesa");
  });

  it("passes a real torrent name through unchanged", () => {
    expect(
      getDownloadDisplayName(download("Black.Mesa.Definitive.Edition", { kind: "downloading" }), t),
    ).toBe("Black.Mesa.Definitive.Edition");
  });
});
