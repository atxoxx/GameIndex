import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Database, Gamepad2, HardDrive } from "lucide-react";
import type { Emulator } from "../../types/emulator";
import { formatSize, gameDisplayName, type Game } from "../../types/game";
import { Button, Panel } from "../../components/ui";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { EmulatorStorageCard } from "./EmulatorStorageCard";
import { StorageEmpty } from "./StorageEmpty";
import { gameTotalBytes, parentDir } from "./utils";

interface SizeResult {
  sizeBytes: number;
  rootPath: string;
}

/**
 * Emulators tab — install footprint and ROM sizes side by side.
 *
 * Loads its own emulator list so the Storage page does not pay for it unless
 * the tab is opened.
 */
export function StorageEmulatorsTab() {
  const { games } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { unit } = useSizeUnit();

  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [installBytes, setInstallBytes] = useState<Record<string, number | null>>({});
  const [measuring, setMeasuring] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<Emulator[]>("list_emulators");
        if (!cancelled) setEmulators(list ?? []);
      } catch (err) {
        console.error("list_emulators failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const romsByEmulator = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const game of games) {
      if (!game.installed || !game.emulatorId) continue;
      const list = map.get(game.emulatorId);
      if (list) list.push(game);
      else map.set(game.emulatorId, [game]);
    }
    return map;
  }, [games]);

  const romCount = useMemo(
    () => Array.from(romsByEmulator.values()).reduce((sum, list) => sum + list.length, 0),
    [romsByEmulator],
  );

  const totalBytes = useMemo(() => {
    let bytes = 0;
    for (const value of Object.values(installBytes)) bytes += value ?? 0;
    for (const list of romsByEmulator.values()) {
      for (const game of list) bytes += gameTotalBytes(game);
    }
    return bytes;
  }, [installBytes, romsByEmulator]);

  const measure = useCallback(
    async (emulator: Emulator) => {
      if (!emulator.executablePath) {
        setInstallBytes((prev) => ({ ...prev, [emulator.id]: null }));
        return;
      }
      setMeasuring((prev) => new Set(prev).add(emulator.id));
      try {
        const result = await invoke<SizeResult>("measure_path_size", {
          path: parentDir(emulator.executablePath),
        });
        setInstallBytes((prev) => ({ ...prev, [emulator.id]: result.sizeBytes }));
      } catch (err) {
        console.error("measure_path_size failed", err);
        setInstallBytes((prev) => ({ ...prev, [emulator.id]: null }));
        showToast(t("storage.measureFailed", { name: emulator.name, error: String(err) }), "error");
      } finally {
        setMeasuring((prev) => {
          const next = new Set(prev);
          next.delete(emulator.id);
          return next;
        });
      }
    },
    [showToast, t],
  );

  const measureAll = useCallback(async () => {
    // Sequential on purpose: each measure is a full folder walk, and firing
    // them in parallel would just contend for the same I/O queue.
    for (const emulator of emulators) {
      if (emulator.executablePath) await measure(emulator);
    }
  }, [emulators, measure]);

  const openRomFolder = useCallback(
    async (game: { sizeRootPath?: string; path?: string; name: string; displayName?: string }) => {
      const target = game.sizeRootPath || game.path;
      if (!target) {
        showToast(t("storage.noFolderKnown", { name: gameDisplayName(game) }), "info");
        return;
      }
      try {
        await invoke("open_folder", { path: target });
      } catch (err) {
        showToast(t("storage.couldNotOpenFolder", { error: String(err) }), "error");
      }
    },
    [showToast, t],
  );

  return (
    <div className="storage-emulators">
      <Panel
        tone="raised"
        icon={<Gamepad2 />}
        eyebrow={t("storage.emu.eyebrow")}
        heading={t("storage.emu.heading")}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void measureAll()}
            isLoading={measuring.size > 0}
            leftIcon={<HardDrive />}
          >
            {t("storage.emu.measureAll")}
          </Button>
        }
      >
        <div className="storage-emulators__figures">
          <div className="storage-emulators__figure">
            <span className="storage-emulators__value">{emulators.length}</span>
            <span className="storage-emulators__label">{t("storage.emuTracked")}</span>
          </div>
          <div className="storage-emulators__figure">
            <span className="storage-emulators__value">{romCount}</span>
            <span className="storage-emulators__label">{t("storage.emuRoms")}</span>
          </div>
          <div className="storage-emulators__figure storage-emulators__figure--accent">
            <span className="storage-emulators__value">{formatSize(totalBytes, unit)}</span>
            <span className="storage-emulators__label">{t("storage.emuTotalSize")}</span>
          </div>
        </div>
      </Panel>

      {emulators.length === 0 ? (
        <StorageEmpty
          icon={<Database />}
          title={t("emulators.empty.title")}
          description={t("emulators.empty.desc")}
        />
      ) : (
        <ul className="storage-emulators__list">
          {emulators.map((emulator) => (
            <EmulatorStorageCard
              key={emulator.id}
              emulator={emulator}
              roms={romsByEmulator.get(emulator.id) ?? []}
              installBytes={installBytes[emulator.id]}
              measuring={measuring.has(emulator.id)}
              onMeasure={() => measure(emulator)}
              onOpenRomFolder={openRomFolder}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
