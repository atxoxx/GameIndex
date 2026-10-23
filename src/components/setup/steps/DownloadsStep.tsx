import { useNavigate } from "react-router-dom";
import { FolderOpen, Zap } from "lucide-react";
import { useDownloads } from "../../../context/DownloadContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useSetupWizard } from "../../../context/SetupWizardContext";
import { Button } from "../../ui";
import { SetupInfo, SetupSection, SetupToggle } from "../SetupControls";

/** Tenth step: default download location and debrid configuration. */
export default function DownloadsStep() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { closeWizard } = useSetupWizard();
  const {
    defaultDownloadPath,
    setDefaultDownloadPath,
    alwaysAskPath,
    setAlwaysAskPath,
    selectSavePath,
    debridProvider,
  } = useDownloads();

  const chooseFolder = async () => {
    const picked = await selectSavePath();
    if (picked) setDefaultDownloadPath(picked);
  };

  const debridLabel =
    debridProvider === "none"
      ? t("setup.downloads.debridNone")
      : debridProvider;

  return (
    <div className="setup-step">
      <SetupSection title={t("setup.downloads.heading")} desc={t("setup.downloads.body")}>
        <div className="setup-folder">
          <span className="setup-row__icon" aria-hidden="true">
            <FolderOpen size={17} />
          </span>
          <div className="setup-folder__text">
            <span className="setup-folder__label">
              {t("setup.downloads.folder")}
              <SetupInfo tip={t("setup.downloads.folderTip")} />
            </span>
            <span className="setup-folder__path">
              {defaultDownloadPath || t("setup.downloads.none")}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FolderOpen size={14} />}
            onClick={() => void chooseFolder()}
          >
            {t("setup.downloads.choose")}
          </Button>
        </div>

        <div className="setup-toggle-list">
          <SetupToggle
            title={t("setup.downloads.alwaysAsk")}
            tip={t("setup.downloads.alwaysAskTip")}
            checked={alwaysAskPath}
            onChange={setAlwaysAskPath}
          />
        </div>

        <div className="setup-store">
          <span className="setup-row__icon" aria-hidden="true">
            <Zap size={17} />
          </span>
          <span className="setup-store__name">
            {t("setup.downloads.debrid")}
            <SetupInfo tip={t("setup.downloads.debridTip")} />
          </span>
          <span className="setup-store__value">{debridLabel}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              closeWizard();
              navigate("/settings/downloads");
            }}
          >
            {t("setup.downloads.openSettings")}
          </Button>
        </div>
      </SetupSection>
    </div>
  );
}
