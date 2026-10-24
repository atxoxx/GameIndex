// Persistent right-hand inspector for the Emulators workbench. It answers
// "what is this ROM, and what can I do with it right now" without opening a
// modal, and shows the system's next setup step when nothing is selected.

import {
  CalendarDays,
  Clock3,
  Disc3,
  Eye,
  FolderOpen,
  Gamepad2,
  Heart,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { Button, Tooltip } from "../ui";
import type { Game } from "../../types/game";
import { formatBytesShort } from "../../types/download";
import { thumbVariantUrl } from "../../utils/artworkUrl";
import type { EmulatorVisual } from "./emulatorUi";

interface InspectorProps {
  game: Game | null;
  discs: Game[];
  visual: EmulatorVisual;
  accentColor: string;
  isRunning: boolean;
  ready: boolean;
  romCount: number;
  onLaunch: (game: Game) => void;
  onDetails: (game: Game) => void;
  onOpenLocation: (path: string) => void;
  onRename: (game: Game) => void;
  onDelete: (game: Game) => void;
  onToggleFavorite: (game: Game) => void;
  onSelectDisc: (game: Game) => void;
  onScan: () => void;
  onAddRom: () => void;
}

function fmtDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function EmulatorRomInspector({
  game,
  discs,
  visual,
  accentColor,
  isRunning,
  ready,
  romCount,
  onLaunch,
  onDetails,
  onOpenLocation,
  onRename,
  onDelete,
  onToggleFavorite,
  onSelectDisc,
  onScan,
  onAddRom,
}: InspectorProps) {
  const { t } = useLanguage();

  if (!game) {
    return (
      <aside className="emu-wb-inspector emu-wb-inspector--empty" style={{ ["--emu-accent" as string]: accentColor }}>
        <div className="emu-wb-inspector-empty-art" aria-hidden>
          {visual.logo ? <img src={visual.logo} alt="" loading="lazy" /> : <span>{visual.glyph}</span>}
        </div>
        <h3>{t("emulators.inspector.emptyTitle")}</h3>
        <p>{ready ? t("emulators.inspector.emptyReady") : t("emulators.inspector.emptySetup")}</p>
        <div className="emu-wb-inspector-empty-actions">
          {ready ? (
            <>
              <Button variant="secondary" size="sm" leftIcon={<RefreshCw size={14} />} onClick={onScan}>
                {t("emulators.scan")}
              </Button>
              <Button variant="ghost" size="sm" leftIcon={<Plus size={14} />} onClick={onAddRom}>
                {t("emulators.games.addRom")}
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" leftIcon={<Gamepad2 size={14} />} onClick={onAddRom}>
              {t("emulators.games.addRom")}
            </Button>
          )}
        </div>
        <dl className="emu-wb-inspector-facts">
          <div>
            <dt>{t("emulators.detail.gamesTitle")}</dt>
            <dd>{romCount}</dd>
          </div>
          <div>
            <dt>{t("emulators.list.title")}</dt>
            <dd>{visual.known?.name ?? t("emulators.customSystem")}</dd>
          </div>
        </dl>
      </aside>
    );
  }

  const cover = thumbVariantUrl(game.coverArtUrl || game.iconUrl) ?? (game.coverArtUrl || game.iconUrl);
  const badges = [
    game.romRegion,
    game.romLanguage,
    game.romArchived ? t("emulators.roms.archived") : null,
  ].filter(Boolean) as string[];

  return (
    <aside className="emu-wb-inspector" style={{ ["--emu-accent" as string]: accentColor }}>
      <div className="emu-wb-inspector-art">
        {cover ? (
          <img src={cover} alt="" loading="lazy" />
        ) : (
          <div className="emu-wb-inspector-generated">
            {visual.logo ? <img src={visual.logo} alt="" loading="lazy" /> : <span>{visual.glyph}</span>}
            <span className="emu-wb-inspector-generated-title">{game.name}</span>
          </div>
        )}
        {game.favorite && (
          <span className="emu-wb-inspector-fav" title={t("emulators.roms.favorite")}>
            <Heart size={13} fill="currentColor" />
          </span>
        )}
      </div>

      <div className="emu-wb-inspector-head">
        <h3 title={game.name}>{game.name}</h3>
        <div className="emu-wb-inspector-badges">
          <span className="emu-wb-inspector-badge">{game.platform}</span>
          {badges.map((badge) => (
            <span key={badge} className="emu-wb-inspector-badge emu-wb-inspector-badge--muted">
              {badge}
            </span>
          ))}
          {game.romDisc && (
            <span className="emu-wb-inspector-badge emu-wb-inspector-badge--accent">
              <Disc3 size={11} /> {t("emulators.roms.discN", { n: game.romDisc })}
            </span>
          )}
        </div>
      </div>

      <div className="emu-wb-inspector-actions">
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Play size={14} />}
          onClick={() => onLaunch(game)}
          disabled={isRunning}
        >
          {isRunning ? t("game.running") : t("emulators.games.launch")}
        </Button>
        <Tooltip content={t("game.viewDetails")}>
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            aria-label={t("game.viewDetails")}
            onClick={() => onDetails(game)}
            leftIcon={<Eye size={15} />}
          />
        </Tooltip>
        <Tooltip content={game.favorite ? t("emulators.roms.favoriteRemove") : t("emulators.roms.favoriteAdd")}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={game.favorite ? t("emulators.roms.favoriteRemove") : t("emulators.roms.favoriteAdd")}
            onClick={() => onToggleFavorite(game)}
            leftIcon={<Heart size={15} fill={game.favorite ? "currentColor" : "none"} />}
          />
        </Tooltip>
        <Tooltip content={t("emulators.games.openLocation")}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t("emulators.games.openLocation")}
            onClick={() => onOpenLocation(game.romPath ?? game.path)}
            leftIcon={<FolderOpen size={15} />}
          />
        </Tooltip>
        <Tooltip content={t("emulators.games.rename")}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t("emulators.games.rename")}
            onClick={() => onRename(game)}
            leftIcon={<Pencil size={15} />}
          />
        </Tooltip>
        <Tooltip content={t("emulators.games.deleteRom")}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t("emulators.games.deleteRom")}
            onClick={() => onDelete(game)}
            leftIcon={<Trash2 size={15} />}
          />
        </Tooltip>
      </div>

      <dl className="emu-wb-inspector-facts">
        <div>
          <dt>{t("emulators.games.size")}</dt>
          <dd>{game.sizeBytes ? formatBytesShort(game.sizeBytes) : "—"}</dd>
        </div>
        <div>
          <dt>{t("game.playTime")}</dt>
          <dd>{game.playTime && game.playTime !== "0h" ? game.playTime : "—"}</dd>
        </div>
        <div>
          <dt>{t("game.lastPlayed")}</dt>
          <dd>
            <Clock3 size={11} aria-hidden /> {fmtDate(game.lastPlayed)}
          </dd>
        </div>
        <div>
          <dt>{t("emulators.games.added")}</dt>
          <dd>
            <CalendarDays size={11} aria-hidden /> {fmtDate(game.addedAt)}
          </dd>
        </div>
      </dl>

      {game.compatNotes && (
        <div className="emu-wb-inspector-notes">
          <span>{t("emulators.roms.notes")}</span>
          <p>{game.compatNotes}</p>
        </div>
      )}

      {discs.length > 1 && (
        <div className="emu-wb-inspector-discs">
          <h4>
            <Disc3 size={13} /> {t("emulators.roms.discSetTitle", { count: discs.length })}
          </h4>
          <div className="emu-wb-inspector-disc-list">
            {discs.map((disc, index) => (
              <button
                key={disc.id}
                type="button"
                className={`emu-wb-inspector-disc${disc.id === game.id ? " is-active" : ""}`}
                onClick={() => onSelectDisc(disc)}
              >
                <span className="emu-wb-inspector-disc-n">{disc.romDisc ?? index + 1}</span>
                <span className="emu-wb-inspector-disc-name">{disc.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="emu-wb-inspector-path" title={game.romPath ?? game.path}>
        {game.romPath ?? game.path}
      </p>
    </aside>
  );
}
