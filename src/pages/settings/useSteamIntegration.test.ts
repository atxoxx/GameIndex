import { describe, it, expect } from "vitest";
import { shouldRemoveSteamLibraryEntry } from "./useSteamIntegration";

describe("shouldRemoveSteamLibraryEntry", () => {
  it("removes a library entry whose game was uninstalled via Steam", () => {
    // Installed in the library, gone from disk, appmanifest deleted → real uninstall.
    expect(shouldRemoveSteamLibraryEntry(true, false, false)).toBe(true);
  });

  it("keeps the entry while the game is still installed", () => {
    expect(shouldRemoveSteamLibraryEntry(true, true, true)).toBe(false);
    expect(shouldRemoveSteamLibraryEntry(true, true, false)).toBe(false);
  });

  it("keeps an owned-but-never-installed entry in the library", () => {
    expect(shouldRemoveSteamLibraryEntry(false, false, false)).toBe(false);
    expect(shouldRemoveSteamLibraryEntry(false, false, true)).toBe(false);
  });

  it("keeps the entry when the manifest is present (mid-update, StateFlags blip)", () => {
    // Steam keeps the appmanifest during an update — only a real
    // uninstall deletes it. A present manifest must never trigger removal.
    expect(shouldRemoveSteamLibraryEntry(true, false, true)).toBe(false);
  });
});
