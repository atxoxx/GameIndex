import "@testing-library/jest-dom/vitest";

// This jsdom version exposes no `localStorage` (and Node 22's experimental
// global is only available with `--localstorage-file`), so every test that
// touches the storage-backed utils (`gameAccentCache`, `activeGameArtwork`,
// `useGameUpdateCheck`, recent-items storage) would throw on
// `localStorage.clear()`. Install a tiny in-memory implementation on both
// the window and the global so those tests exercise real storage logic
// instead of crashing in the harness.
const storageBacking = new Map<string, string>();
const memoryStorage: Storage = {
  get length() {
    return storageBacking.size;
  },
  clear: () => storageBacking.clear(),
  getItem: (key: string) => storageBacking.get(key) ?? null,
  key: (index: number) => [...storageBacking.keys()][index] ?? null,
  removeItem: (key: string) => {
    storageBacking.delete(key);
  },
  setItem: (key: string, value: string) => {
    storageBacking.set(key, String(value));
  },
};

if (typeof window !== "undefined" && !window.localStorage) {
  Object.defineProperty(window, "localStorage", {
    value: memoryStorage,
    configurable: true,
  });
}
if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
  });
}
