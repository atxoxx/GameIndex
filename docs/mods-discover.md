# Mods Discover - Feature Guide

**Discover** is GameIndex's built-in mod browser. Instead of leaving the launcher to hunt for mods,
you can search and page through seven mod sites, read rich mod pages, and install downloaded archives
straight into a game's mod folder - all from the Mods area.

Discover complements the existing **Installed** manager (which scans, enables/disables, reorders and
detects conflicts). Discover finds mods; the manager maintains them.

For the implementation map, see the "Mods Discover" section of
[`knowledge.md`](../knowledge.md).

---

## Table of contents

1. [At a glance](#at-a-glance)
2. [Getting there](#getting-there)
3. [Connecting mod sites](#connecting-mod-sites)
4. [Mapping a game to a site](#mapping-a-game-to-a-site)
5. [Browsing mods](#browsing-mods)
6. [Bookmarks & history](#bookmarks--history)
7. [Reading a mod page](#reading-a-mod-page)
8. [Installing a mod](#installing-a-mod)
9. [Supported sources](#supported-sources)
10. [Troubleshooting](#troubleshooting)
11. [Related](#related)

---

## At a glance

| Capability | What it does |
|---|---|
| **Seven sources** | Nexus, Thunderstore, GameBanana, ModDB, CurseForge, mod.io and Steam Workshop. |
| **Full catalogue** | Nexus is paged through the v2 GraphQL API; other sources page natively. |
| **Rich detail** | Description (BBCode/HTML), photo gallery, video embeds, file lists and metadata. |
| **Filters** | Source, sort, installed state, category facets and tag facets. |
| **Views** | Grid, list and compact, remembered per game. |
| **Bookmarks** | Save any mod locally and revisit it. |
| **Install history** | Every remote install is logged with provenance. |
| **One-click installs** | Direct downloads extract into the game's mod root; external/premium files open the mod page. |

---

## Getting there

- **From the Mods page:** open **Mods**, then switch the header tabs to **Discover**, or press the
  **Discover** button to open the standalone route.
- **Standalone route:** `/mods/discover` (optionally `?gameId=<id>` to preselect a game).
- **From a game:** the game detail **Mods** tab exposes the same Installed / Discover subtabs.

Discover is always scoped to a game. Pick one in the game rail, and Discover resolves which mod sites
host it.

---

## Connecting mod sites

Some sources need an API key; others work anonymously.

1. Open **Settings → Integrations → Mod sites** (or follow the deep link Discover offers).
2. Paste an API key per source and press **Save**. Use **Clear** to remove one.

Keys are stored in your **OS keychain**, never in plain files.

| Source | Credential |
|---|---|
| **Nexus Mods** | Personal API key (required). Premium unlocks direct downloads; free accounts open the mod page. |
| **CurseForge** | API key (required). |
| **mod.io** | API key (required). |
| **Steam Workshop** | Uses your existing Steam session; no separate key. |
| **Thunderstore / GameBanana / ModDB** | No key needed. |

A source chip in the Discover toolbar shows each site's status: ready, needs key, or unmapped.

---

## Mapping a game to a site

Discover matches your game's title to a site's game entry automatically when you open it. If the match
is wrong or missing:

- Open the **Sources** subtab and use **Resolve** to re-run detection, or
- Set the **external id / slug** for a source manually (the mapping is remembered per game).

Mappings persist in the mods database, so a corrected match survives restarts.

---

## Browsing mods

The browse subtab is the main surface:

- **Sort** by trending, downloads, updated or latest (Nexus defaults to endorsements when no search term is typed).
- **Filter** by source, installed status (installed / not installed / bookmarked) and category.
- **Tag facets** narrow long result sets.
- **Views** - grid, list or compact; the choice is remembered per game.
- **Search** runs against the active source with a short debounce.
- **Paging** happens automatically as you scroll, with a **Load more** button as a fallback and a
  **back to top** shortcut.
- A **spotlight** card highlights a featured top result on the first page.

---

## Bookmarks & history

- **Bookmarks** - the bookmark button on any mod card saves it locally (`gamelib.mods.bookmarks_v1`).
  The Bookmarks subtab lists them, and they survive restarts and source outages.
- **History** - every remote install is recorded with its source, mod id and file id. The History
  subtab lists them and lets you remove entries.

---

## Reading a mod page

Clicking a mod opens a detail modal with three tabs:

- **Overview** - full description, rendered safely from BBCode/HTML (never raw HTML), plus author,
  version, downloads and tags.
- **Files** - every downloadable file with size, version and an action (Install, Open, or a Steam
  deep link for Workshop items).
- **Gallery** - screenshots and video embeds (YouTube/Vimeo and direct media) in a full-screen lightbox.

The footer carries the primary install action; the header links out to the mod page, a share action,
and (for Steam Workshop) a `steam://` deep link that subscribes in the Steam client.

---

## Installing a mod

Press **Install** on a card or in the detail modal:

1. GameIndex resolves a download plan for the source and file.
2. **Direct** downloads stream to a temporary folder, then extract (zip, 7z or rar) into the game's
   mod root. Progress is shown inline.
3. **External** or **Premium-only** results (e.g. a free Nexus account) do not download directly -
   GameIndex opens the mod page so you can download it yourself, then use the manual install modal.
4. If a format cannot be extracted automatically, the archive is kept and the manual modal opens.

The install target is, in order: an explicit destination, the game's **custom mod root**, or the
auto-detected mod root (BepInEx, MelonLoader, Unreal `~mods`, Bethesda `Data`, or a generic `Mods/`
folder). After a successful install, GameIndex rescans the game so the new mod appears under
**Installed** immediately.

> **Note:** Discover installs files into the mod folder; it does not install mod loaders like BepInEx
> or MelonLoader. Install the loader first if a mod needs one.

---

## Supported sources

| Source | Key | Direct downloads | Notes |
|---|---|---|---|
| **Nexus Mods** | Required | Premium only | v2 GraphQL catalogue; v1 feed fallback; per-file listing. |
| **Steam Workshop** | Steam session | No (subscribe in Steam) | Browse + rich detail; items are managed read-only by Steam. |
| **Thunderstore** | No | Yes | Community/package registry (Unity, BepInEx ecosystems). |
| **GameBanana** | No | Yes | Broad game-modding site. |
| **ModDB** | No | Yes | Paged scrape, sorted in memory. |
| **CurseForge** | Required | Yes | v1 REST API. |
| **mod.io** | Required | Yes | REST API with offset/limit paging. |

---

## Troubleshooting

- **A source shows "needs key".** Add its API key in Settings → Integrations → Mod sites.
- **The wrong game is matched.** Open the Sources subtab, re-resolve, or set the external id manually.
- **Install does nothing for a Nexus mod.** Nexus direct downloads require a Premium account; a free
  account offers the mod page instead. Download manually and use the manual install modal.
- **The archive will not extract.** Some packs use nested or unusual formats - GameIndex keeps the
  archive and opens the manual install flow so you can place the files yourself.
- **The new mod is not visible.** Switch to the **Installed** tab; if it is still missing, rescan the game.
- **Bookmarks persist but results are gone.** Bookmarked entries are stored locally, so they remain
  available even if a source is temporarily unreachable.

---

## Related

- [In-Game Overlay & Capture guide](in-game-overlay.md) - capture a modded session.
- [Plugin authoring guide](plugins/README.md) - extend download search with plugins.
- [`knowledge.md`](../knowledge.md) - Discover backend architecture.
