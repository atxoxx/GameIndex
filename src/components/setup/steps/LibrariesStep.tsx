import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus2, FolderSearch } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { useSetupWizard } from "../../../context/SetupWizardContext";
import { useToast } from "../../../context/ToastContext";
import { gameNameFromPath, type GameMetadataResult } from "../../../types/game";
import ImportModal, { type ExeInfo } from "../../ImportModal";
import FolderScanProgressModal from "../../library/FolderScanProgressModal";
import { Button } from "../../ui";
import { SetupInfo, SetupSection, SetupToggle } from "../SetupControls";

/** Settings labels for the supported store accounts, in display order. */
const STORES = [
  "steam",
  "epicGames",
  "gogGalaxy",
  "humbleBundle",
  "rockstarGamesLauncher",
  "ubisoftConnect",
  "battleNet",
  "ea",
  "xbox",
  "itch",
] as const;

/**
 * Library & accounts — one page for getting games in: add a single
 * executable, scan a folder, and connect the stores you own games on.
 * The add/scan flow reuses the sidebar's import pipeline verbatim
 * (`ImportModal` + `FolderScanProgressModal` + `importLocalGames`), so
 * the wizard behaves exactly like the main library UI.
 */
export default function LibrariesStep() {
  const { t } = useLanguage();
  const { games, importLocalGames } = useGames();
  const { showToast } = useToast();
  const { closeWizard } = useSetupWizard();
  const { steamAutoDetect, setSteamAutoDetect } = useSettings();
  const navigate = useNavigate();

  const existingPathsSet = useMemo(
    () =>
      new Set(
        games
          .map((g) => (g.path || "").toLowerCase().trim())
          .filter(Boolean),
      ),
    [games],
  );

  const [scannedExes, setScannedExes] = useState<ExeInfo[]>([]);
  const [importRootPath, setImportRootPath] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [showScanProgressModal, setShowScanProgressModal] = useState(false);
  const [scanFolderPaths, setScanFolderPaths] = useState<string[]>([]);

  async function handleAddGame() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: t("sidebar.selectGameExe"),
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (filePath && typeof filePath === "string") {
        const existing = games.find(
          (g) => (g.path || "").toLowerCase().trim() === filePath.toLowerCase().trim(),
        );
        if (existing) {
          showToast(
            t("sidebar.alreadyInLibrary", { name: gameNameFromPath(filePath) }),
            "info",
          );
          return;
        }
        setScannedExes([
          { path: filePath, size: 0, modifiedAt: Math.round(Date.now() / 1000) },
        ]);
        setImportRootPath(filePath.replace(/[\\/][^\\/]*$/, ""));
        setShowImportModal(true);
      }
    } catch (err) {
      console.error("Failed to import exe:", err);
    }
  }

  async function handleScanFolder() {
    try {
      const selected = await open({
        multiple: true,
        directory: true,
        title: t("sidebar.selectFolderScan"),
      });
      const paths: string[] = Array.isArray(selected)
        ? selected
        : typeof selected === "string"
          ? [selected]
          : [];
      if (paths.length > 0) {
        setScanFolderPaths(paths);
        setShowScanProgressModal(true);
      }
    } catch (err) {
      console.error("Failed to select folders for scan:", err);
    }
  }

  const handleScanComplete = useCallback(
    (exes: ExeInfo[], rootPath: string) => {
      setShowScanProgressModal(false);
      if (exes.length === 0) {
        showToast(t("sidebar.noExesFound"), "info");
        return;
      }
      setScannedExes(exes);
      setImportRootPath(rootPath);
      setShowImportModal(true);
    },
    [showToast, t],
  );

  async function handleConfirmImport(
    imports: { path: string; metadata: GameMetadataResult | null }[],
    errors?: { name: string; message: string }[],
  ) {
    setShowImportModal(false);
    await importLocalGames(imports);
    if (errors && errors.length > 0) {
      showToast(
        t("import.importPartial", { ok: imports.length, failed: errors.length }),
        "error",
      );
    }
  }

  const openIntegrations = () => {
    closeWizard();
    navigate("/settings/integrations");
  };

  return (
    <div className="setup-step">
      <SetupSection title={t("setup.libraries.heading")} desc={t("setup.libraries.body")}>
        <div className="setup-inline-actions">
          <span className="setup-action">
            <Button
              variant="secondary"
              leftIcon={<FilePlus2 size={14} />}
              onClick={() => void handleAddGame()}
            >
              {t("setup.libraries.addGame")}
            </Button>
            <SetupInfo tip={t("setup.libraries.addGameTip")} />
          </span>
          <span className="setup-action">
            <Button
              variant="secondary"
              leftIcon={<FolderSearch size={14} />}
              onClick={() => void handleScanFolder()}
            >
              {t("setup.libraries.scanFolder")}
            </Button>
            <SetupInfo tip={t("setup.libraries.scanFolderTip")} />
          </span>
        </div>

        <div className="setup-toggle-list">
          <SetupToggle
            title={t("setup.libraries.steamDetect")}
            tip={t("setup.libraries.steamDetectTip")}
            checked={steamAutoDetect}
            onChange={setSteamAutoDetect}
          />
        </div>
      </SetupSection>

      <SetupSection title={t("setup.stores.heading")} desc={t("setup.stores.body")}>
        <div className="setup-store-list">
          {STORES.map((key) => {
            const store = t(`settings.integration.${key}`);
            return (
              <div key={key} className="setup-store">
                <span className="setup-store__name">
                  {store}
                  <SetupInfo tip={t("setup.stores.connectTip", { store })} />
                </span>
                <Button variant="secondary" size="sm" onClick={openIntegrations}>
                  {t("setup.stores.connect")}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="setup-section__note">{t("setup.stores.betaNote")}</p>
      </SetupSection>

      {showImportModal && (
        <ImportModal
          exeInfos={scannedExes}
          rootPath={importRootPath}
          existingPaths={games.map((g) => g.path)}
          onConfirm={handleConfirmImport}
          onCancel={() => setShowImportModal(false)}
        />
      )}

      {showScanProgressModal && (
        <FolderScanProgressModal
          open={showScanProgressModal}
          folderPaths={scanFolderPaths}
          existingPaths={existingPathsSet}
          onComplete={handleScanComplete}
          onCancel={() => setShowScanProgressModal(false)}
        />
      )}
    </div>
  );
}
