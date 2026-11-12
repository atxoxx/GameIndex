# Electron backend contract (read before porting)

This file is the shared rulebook for the ported backend. It exists so parallel
work stays compatible.

## Where things live

```
electron/main/
  index.ts              app lifecycle (do not edit outside integration work)
  ipc.ts                command registry, events, window verbs (shared)
  smoke.ts              boot harness (GI_SMOKE_TEST=1)
  commands/
    index.ts            registers every module, then the stubs (shared)
    <area>.ts           one module per feature area, exports a registrar
  state/
    appSettings.ts      main-process settings (shared)
    jsonStore.ts        atomic JSON documents (shared)
    db/                 SQLite layer (owned by the data workstream)
  lib/
    http.ts             fetch/JSON/text/stream + cookie jars (shared)
    secrets.ts          build-time keys + .env fallback (shared)
    paths.ts            userData/db/cache/temp helpers (shared)
  features/<area>/      implementation modules for one area
  surfaces/             windows, tray, overlay, webviews (shared)
```

**Ownership rule:** a workstream edits only the folders it was assigned. In
particular, do **not** edit `ipc.ts`, `commands/index.ts`, `lib/*`,
`state/appSettings.ts`, `surfaces/*`, `src/*`, or the Vite configs.

## Adding a command

1. Put the handler in your own module:

   ```ts
   import type { CommandHandler } from "../ipc";
   import { emit } from "../ipc";

   export const featureCommands: Record<string, CommandHandler> = {
     my_command: async (args, ctx) => {
       // args are the exact keys the renderer passes to invoke("my_command", {...})
       return result;
     },
   };
   ```

2. Register it through the registrar that `commands/index.ts` already calls:

   ```ts
   export function registerFeatureCommands(): void {
     registerCommands(featureCommands, { override: true });
   }
   ```

   Registrars run before the stub layer, so a name you register stops rejecting.

3. Look up the exact argument and return shapes in the React call sites
   (`src/**/*.tsx` greps for the command name) and in the retired Rust code.

## Reference implementation

The Rust backend is deleted from the working tree but still in git history:

```powershell
git show HEAD:src-tauri/src/downloads/manager.rs
git show HEAD:src-tauri/src/db/schema_games.sql
git ls-tree -r --name-only HEAD src-tauri/src
```

Match the Rust behaviour (including error strings that the UI surfaces), not the
literal Rust structure.

## Libraries available

| Need | Package | Notes |
|---|---|---|
| SQLite | `better-sqlite3` | synchronous, works in Electron 38 without a rebuild here |
| HTML parsing / scraping | `cheerio` | use with `lib/http.ts` |
| Zip / archive | `adm-zip` | save backups, mod archives |
| Plugin sandbox | `quickjs-emscripten` | mirrors `rquickjs` usage |
| Auto-update | `electron-updater` | replaces the Tauri updater plugin |
| HTTP | `lib/http.ts` | never call `fetch` directly for scraped sites |

Ask before adding another dependency. Prefer Node built-ins otherwise.

## Events

The renderer listens for events by name (see `src/**/listen(...)`). Emit them
with `emit(name, payload)` from `ipc.ts`; payload shapes must match what the Rust
backend sent. Never invent an event name the UI does not listen for.

Progress-heavy commands should emit throttled updates (≤ 10/s), not per byte.

## Errors and degradation

- Throw `new Error("<what failed> — <what the user can do>")`. The renderer shows
  it, so no stack traces and no silent `null` when work actually failed.
- Empty first-run state may legitimately return `[]` / `null`; document each one
  in `PORTING.md`.
- Long operations must be cancellable (check an `AbortController` or a stored
  cancel flag between chunks/files).
- Never block the main thread: use async fs (`node:fs/promises`) for big trees,
  and `setImmediate`/`await` yield points inside loops.

## Data

- Core library domains (games, sessions, notes, shelves, wishlist, save metadata)
  are SQLite, owned by the data workstream. Use the exported functions from
  `state/libraryStore.ts` etc. — do not open the database yourself.
- Feature-local caches may use `state/jsonStore.ts` for this wave. Do not add new
  database tables without coordinating with the data workstream.
- All new files go under `userData` via `lib/paths.ts`.

## Verification before reporting done

```powershell
npx tsc --noEmit          # must be clean (strict, noUnusedLocals)
npx electron-vite build   # must succeed
```

If your feature has pure logic (parsers, formatters, matchers), add a Vitest test
under `src/**` only if it does not touch Electron; otherwise write a small Node
script and report its output. Do not run `npm run dev:electron` (opens a GUI and
blocks). The integrator runs the final boot smoke test.

## Reporting

State what is implemented, what is still stubbed, which Rust file each port came
from, data locations, and any behaviour you could not verify.
