import {
  Activity,
  ArchiveRestore,
  BadgePercent,
  BookOpen,
  Command,
  Compass,
  Cpu,
  Database,
  Download,
  Gamepad2,
  HardDrive,
  Heart,
  HelpCircle,
  Keyboard,
  KeyRound,
  LayoutDashboard,
  Library,
  ListFilter,
  Monitor,
  MonitorPlay,
  Newspaper,
  Palette,
  Puzzle,
  Rocket,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  Terminal,
  Trophy,
  Users,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

export type DocBadgeType = "core" | "setup" | "guide" | "proTip" | "linux" | "reference";

export interface DocSubcategory {
  id: string;
  categoryId: string;
  title: string;
  summary: string;
  badge: DocBadgeType;
  icon: LucideIcon;
  keywords: string[];
  body: string;
  relatedIds?: string[];
}

export interface DocCategory {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  subcategories: DocSubcategory[];
}

export interface QuickStartCard {
  id: string;
  subcategoryId: string;
  titleKey: string;
  descKey: string;
  defaultTitle: string;
  defaultDesc: string;
  badge: string;
  icon: LucideIcon;
}

export const DOC_CATEGORIES: DocCategory[] = [
  // ── 1. Getting Started ───────────────────────────────────────────────────
  {
    id: "getting-started",
    title: "Getting Started",
    description: "Core architecture, initial setup, interface overview, and universal shortcuts.",
    icon: Rocket,
    subcategories: [
      {
        id: "welcome",
        categoryId: "getting-started",
        title: "Welcome to GameIndex",
        summary: "Overview of GameIndex's unified, local-first architecture and privacy guarantees.",
        badge: "core",
        icon: Rocket,
        keywords: ["overview", "architecture", "local-first", "sqlite", "privacy", "cross-store"],
        relatedIds: ["firststeps", "layout", "commandpalette"],
        body: `GameIndex is a **unified, local-first game launcher and library manager**. It brings your games across Steam, GOG, Epic, Rockstar, Ubisoft, Humble Bundle, DRM-free executables, and retro emulators into a single, blazing-fast native application.

## Why GameIndex?
Unlike launcher wrappers that are web wrappers or rely on remote servers, GameIndex is engineered for **speed, sovereignty, and privacy**:
- **Local-First SQLite Database**: All game entries, playtime logs, telemetry, and notes live in an embedded SQLite database (\`gamelib.db\`) on your local drive with Write-Ahead Logging (WAL) mode.
- **Zero Plaintext Secrets**: Your store tokens and API keys are stored directly in your operating system's native keychain (Windows Credential Manager or Linux Secret Service).
- **Controller-First 10-Foot UI**: Switch seamlessly into Big Screen mode (\`F11\` or \`Ctrl+B\`) with full controller navigation, backdrops, and TV scaling.
- **Built-in Power Tools**: Integrated downloads engine, drive storage visualizer, retro emulators & ROM manager, and Linux Proton/Wine runner manager.

> [!NOTE]
> GameIndex works 100% offline. If your internet connection drops, you can still launch every installed game, review past playtime, read notes, and organize your collection.`,
      },
      {
        id: "firststeps",
        categoryId: "getting-started",
        title: "Getting Started: 3-Minute Setup",
        summary: "Step-by-step checklist to get your entire collection up and running in minutes.",
        badge: "setup",
        icon: Compass,
        keywords: ["quickstart", "setup", "onboarding", "import", "first run", "checklist"],
        relatedIds: ["welcome", "steam", "library"],
        body: `Setting up GameIndex is straightforward. Follow these three steps to build your unified gaming hub.

### Step 1: Connect Your Store Accounts
- Navigate to **Settings → Integrations** using the top navigation bar.
- Under **Steam**, enter your Steam Web API Key and your 64-bit SteamID. Click **Sync Steam Library**.
- Under **GOG Galaxy**, click **Connect GOG** to log in through the secure embedded webview.
- Under **Epic Games**, click **Authorize Epic** to pair your Epic account.

> [!TIP]
> You do not need to connect all stores right away. You can add more accounts at any time from Settings.

### Step 2: Add Local Executables and ROMs
- Click the **+ Import** button at the top of the sidebar.
- Choose **Scan Directory** to point GameIndex to a game folder (e.g., \`D:\\Games\`) for automatic executable detection, or click **Add Single Game** to pick an \`.exe\` directly.
- For retro games, visit the **Emulators** tab to configure your console platforms and point to your ROM directories.

### Step 3: Launch and Personalize
- Head to **Library** to browse your unified grid.
- Hover any game tile to view quick actions, or click to open the **Game Details** page.
- Hit **Play**! GameIndex will automatically detect the game running, track your session, and record your playtime.

> [!PRO TIP]
> Press \`Ctrl+K\` from anywhere in the app to open the Command Palette. It lets you launch games, jump to settings, and search the store with just a few keystrokes.`,
      },
      {
        id: "layout",
        categoryId: "getting-started",
        title: "Main Interface & Navigation Tour",
        summary: "Understanding the top navigation bar, collapsible sidebar, and responsive breakpoints.",
        badge: "core",
        icon: LayoutDashboard,
        keywords: ["interface", "layout", "top bar", "sidebar", "rail", "navigation", "window"],
        relatedIds: ["firststeps", "commandpalette", "interface"],
        body: `The GameIndex desktop interface is designed to maximize screen real estate while keeping all controls immediately accessible.

## Layout Breakdown
- **Top Navigation Bar**: Hosts global search, reorderable feature tabs (Library, Store, Deals, Activity, Emulators, Mods, Downloads, Storage, Settings), the **Now Playing** live session chip, and window management controls.
- **Sidebar**: Your library command center. Contains the Import button, instant library search, filter toolbox, Favorites and Recents shelves, and alphabet scrubber.
- **Main Canvas**: The primary content region. Adapts fluidly to wide 4K desktop screens, ultrawide monitors, and handheld displays like the Steam Deck.
- **Status & Popovers**: Quick-access popovers for active downloads and audio volume at the top-right.

## Adaptive Sidebar
- Click the **Collapse Sidebar** button (or drag the sidebar edge) to fold the sidebar into a high-density **Icon Rail**.
- On narrow displays or handhelds (under 960px width), the sidebar folds into the rail automatically to preserve grid space.

> [!NOTE]
> The top navigation tabs are fully customizable! Go to **Settings → Interface** to drag and reorder tabs, hide features you do not use, or switch between **Simple UI** and **Complete UI** modes.`,
      },
      {
        id: "commandpalette",
        categoryId: "getting-started",
        title: "Command Palette (Ctrl+K) Power Guide",
        summary: "Universal search, instantaneous navigation, calculator, and action execution.",
        badge: "proTip",
        icon: Command,
        keywords: ["command palette", "ctrl+k", "shortcut", "search", "calculator", "speed"],
        relatedIds: ["layout", "shortcuts"],
        body: `Press **\`Ctrl+K\`** (or **\`Cmd+K\`** on macOS) at any time to open the universal Command Palette. It is the fastest way to navigate GameIndex without touching your mouse.

## Capabilities
- **Instant Game Launch**: Type any game name and press \`Enter\` to launch it immediately.
- **Direct Navigation**: Type "Downloads", "Storage", "Deals", or "Settings" to switch pages in a millisecond.
- **In-App Calculator**: Type math expressions like \`48 * 60\` or \`1024 / 8\` to compute answers on the fly.
- **Quick Actions**: Trigger library sync, toggle Big Screen mode, clear cache, or randomize a game to play.
- **Recents Memory**: Remembers your most frequent actions so your favorite tools are always one keystroke away.

## Keyboard Shortcuts in the Palette
- \`ArrowUp\` / \`ArrowDown\`: Move between items.
- \`Enter\`: Run the selected command or open game.
- \`Escape\`: Dismiss the palette and return to your screen.

> [!TIP]
> You can also press **\`/\`** while on the Store, Storage, Downloads, or Documentation pages to instantly focus search inputs.`,
      },
    ],
  },

  // ── 2. Store Integrations ────────────────────────────────────────────────
  {
    id: "integrations",
    title: "Store Integrations",
    description: "Connect Steam, GOG, Epic, Ubisoft, Rockstar, and Humble with secure OS keychain storage.",
    icon: Store,
    subcategories: [
      {
        id: "steam",
        categoryId: "integrations",
        title: "Steam Integration & Web API",
        summary: "Connecting your Steam account with API Key and SteamID64 for automatic sync.",
        badge: "setup",
        icon: Store,
        keywords: ["steam", "web api", "steamid", "sync", "family sharing", "playtime"],
        relatedIds: ["gog", "epic", "keychain"],
        body: `GameIndex communicates with the official Steam Web API to sync your full game catalog, achievements, and recorded playtime.

## Setup Instructions
1. Open **Settings → Integrations → Steam**.
2. **Steam Web API Key**: Click the link to open Steam's API key generator (\`steamcommunity.com/dev/apikey\`) and paste your 32-character key.
3. **SteamID64**: Enter your 17-digit numeric SteamID (found in your Steam profile URL).
4. Click **Sync Steam Library**.

## What Gets Synchronized?
- **Games & DLCs**: All owned Steam titles with official poster art, banner hero, and logo graphics.
- **Playtime**: Total lifetime hours recorded on Steam.
- **Achievements**: Full achievement list, unlock dates, and rarity tiers.
- **Family Sharing**: Titles shared with your account are detected and badged accordingly.

> [!IMPORTANT]
> Your Steam Profile and Game Details privacy must be set to **Public** in Steam Settings for the API to fetch your owned games and playtime accurately.`,
      },
      {
        id: "gog",
        categoryId: "integrations",
        title: "GOG Galaxy Authentication",
        summary: "Secure in-app webview login, session cookie capture, and DRM-free installer links.",
        badge: "setup",
        icon: ShieldCheck,
        keywords: ["gog", "galaxy", "drm-free", "webview", "oauth", "cookies"],
        relatedIds: ["steam", "epic", "keychain"],
        body: `GOG integration allows you to sync your DRM-free GOG catalog and access offline backup installers directly.

## Connecting GOG
1. Open **Settings → Integrations → GOG Galaxy**.
2. Click **Connect GOG Account**.
3. A secure, sandboxed Tauri webview window will open displaying GOG's official login page.
4. Sign in with your GOG credentials (including 2FA if enabled).
5. Once authenticated, GameIndex extracts your session tokens, saves them in your encrypted OS keychain, and closes the webview automatically.

## Launching GOG Games
- Games installed via the official GOG GALAXY client are detected automatically.
- DRM-free standalone GOG installers can be launched directly without needing the GOG client running in the background.

> [!NOTE]
> If GOG sync fails after several months, your session cookie may have expired. Simply click **Re-authenticate GOG** to refresh your session.`,
      },
      {
        id: "epic",
        categoryId: "integrations",
        title: "Epic Games Store OAuth",
        summary: "Device authorization, refresh tokens, offline launch capability, and Unreal games.",
        badge: "setup",
        icon: KeyRound,
        keywords: ["epic", "epic games", "oauth", "unreal", "refresh token"],
        relatedIds: ["steam", "gog", "keychain"],
        body: `GameIndex connects to the Epic Games Store via standard OAuth device code authentication, allowing you to import your weekly free claims and purchased titles.

## Authorization Flow
1. Go to **Settings → Integrations → Epic Games**.
2. Click **Authorize Epic Games**.
3. GameIndex will generate a secure authorization code and open the Epic verification page in your default web browser.
4. Confirm authorization. The refresh token is saved directly to your OS keychain.
5. Click **Sync Epic Library** to import your titles.

## Offline & DRM-Free Launching
- Many Epic Games titles support native DRM-free execution. GameIndex can launch these executables directly without launching the Epic Games Launcher, drastically reducing startup latency and background RAM usage.

> [!TIP]
> Claimed free games from Epic appear in your GameIndex library within seconds of clicking sync!`,
      },
      {
        id: "other-stores",
        categoryId: "integrations",
        title: "Rockstar, Ubisoft & Humble Bundle",
        summary: "Client manifest scanning for Rockstar & Ubisoft, and Humble Trove syncing.",
        badge: "guide",
        icon: Sparkles,
        keywords: ["rockstar", "ubisoft", "uplay", "humble", "trove", "manifest"],
        relatedIds: ["steam", "gog", "keychain"],
        body: `GameIndex supports secondary storefronts through local client manifest scanners and Humble account links.

## Ubisoft Connect & Rockstar Games Launcher
- GameIndex scans local client manifest directories on your system:
  - Ubisoft: \`%LOCALAPPDATA%\\Ubisoft Game Launcher\\installedRuns\`
  - Rockstar: \`%PROGRAMDATA%\\Rockstar Games\\Launcher\\InstalledGames\`
- Games installed through these clients are automatically indexed with correct launch protocols (e.g., \`uplay://launch/...\`).

## Humble Bundle
- Connect your Humble Bundle account via **Settings → Integrations → Humble**.
- Access both your purchased Steam key history and DRM-free Humble Trove downloads.`,
      },
      {
        id: "keychain",
        categoryId: "integrations",
        title: "OS Keychain & Security",
        summary: "How GameIndex guards your API keys and tokens using native OS cryptographic storage.",
        badge: "core",
        icon: ShieldCheck,
        keywords: ["security", "keychain", "credential manager", "secret service", "encryption"],
        relatedIds: ["steam", "gog", "epic"],
        body: `Security and user privacy are foundational principles of GameIndex. **Your credentials and tokens are never stored in plaintext configuration files.**

## How Secrets are Stored
| Operating System | Backend Storage Engine | Encryption Type |
| :--- | :--- | :--- |
| **Windows** | Windows Credential Manager | Hardware/DPAPI encrypted user vault |
| **Linux** | Secret Service API (KWallet / GNOME Keyring) | AES-256 encrypted keyring |
| **macOS** | Apple Keychain Services | Secure Enclave / Hardware backed |

## Zero Telemetry Policy
- GameIndex never uploads your library list, store tokens, playtime logs, or telemetry to external servers.
- All network requests are made directly from your client machine to official storefront endpoints (Steam, GOG, Epic, IGDB, SteamGridDB).`,
      },
    ],
  },

  // ── 3. Library & Organization ────────────────────────────────────────────
  {
    id: "library",
    title: "Library & Organization",
    description: "Grid and list views, multi-attribute filtering, saved presets, and bulk operations.",
    icon: Library,
    subcategories: [
      {
        id: "library",
        categoryId: "library",
        title: "Your Library & Views",
        summary: "Switch between visual artwork posters, high-density metadata tables, and adjust card scaling.",
        badge: "core",
        icon: LayoutDashboard,
        keywords: ["grid", "list", "density", "view", "scaling", "poster", "table"],
        relatedIds: ["filters", "sorting", "managing"],
        body: `Your library can be viewed in two distinct display modes, tailored for either visual appreciation or dense data management.

## Grid View
- Showcases high-resolution portrait box art (600x900 aspect ratio) fetched from SteamGridDB and IGDB.
- Hovering any tile reveals quick action overlays: **Play**, **Favorite**, **Edit Details**, and **More Options**.
- An adjustable **Card Density slider** (Compact, Normal, Spacious) lets you control tile size to fit between 4 and 16 cards per row depending on your screen resolution.

## List View
- Displays games in a high-density tabular view with sortable columns:
  - **Title** & Platform Badges
  - **Installation Status** & Install Path
  - **Storage Size** (calculated on disk)
  - **Total Playtime** & Last Played date
  - **Metacritic / User Rating**
  - **Storefront of Origin** (Steam, GOG, Epic, Manual)

> [!TIP]
> Press \`G\` to toggle Grid view and \`L\` to toggle List view when focused in the library!`,
      },
      {
        id: "sidebar",
        categoryId: "library",
        title: "The Sidebar & Icon Rail",
        summary: "Fast navigation, shelf management, and resizing your sidebar.",
        badge: "core",
        icon: SlidersHorizontal,
        keywords: ["sidebar", "rail", "shelves", "favorites", "recents"],
        relatedIds: ["library", "filters"],
        body: `The sidebar is your navigation anchor and the fastest way to work with your collection.

## Top to Bottom
- **Import & Search**: Instant filtering and importing at the top.
- **Favorites & Recents**: Quick access shelves you can expand or collapse.
- **Filter Toolbox**: Platforms, genres, play status, and saved presets.
- **Alphabet Scrubber**: Jump through massive collections by letter.`,
      },
      {
        id: "filters",
        categoryId: "library",
        title: "Multi-Attribute Filters & Presets",
        summary: "Filter by genre, store, install state, tags, and save your favorite view combinations.",
        badge: "guide",
        icon: ListFilter,
        keywords: ["filters", "presets", "tags", "genres", "installed", "backlog"],
        relatedIds: ["library", "sorting", "bulk-actions"],
        body: `GameIndex features a rich multi-select filtering engine located in the sidebar toolbox.

## Available Filters
- **Installation State**: Installed, Not Installed, or Update Available.
- **Storefront**: Filter to Steam only, GOG only, Epic only, or Manual / Emulated titles.
- **Play Status**: Backlog, Currently Playing, Completed, 100% Perfected, or Dropped.
- **Genres & Themes**: RPG, Action, Strategy, Indie, Roguelike, Cyberpunk, Sci-Fi, etc.
- **Hardware & Compatibility**: Deck Verified, Proton Platinum, Controller Supported, VR.

## Saved Filter Presets
Once you have configured a set of filters (e.g. *Installed RPGs with Controller Support*):
1. Click the **Save Preset** button at the top of the filter panel.
2. Enter a custom name (e.g. *"Cozy Deck Games"*).
3. Your preset is pinned to the sidebar for instant one-click activation at any time!`,
      },
      {
        id: "sorting",
        categoryId: "library",
        title: "Sorting & Drive Grouping",
        summary: "Sort your titles by playtime, release date, or disk size, and group by drive mount points.",
        badge: "guide",
        icon: SlidersHorizontal,
        keywords: ["sort", "grouping", "drives", "playtime", "release date", "alphabet"],
        relatedIds: ["library", "filters", "storage"],
        body: `Organize large libraries of hundreds or thousands of games with smart sorting and grouping rules.

## Sorting Options
- **Alphabetical**: A to Z / Z to A (with ignore "The" / "A" article toggles).
- **Recently Played**: Games you launched most recently appear first.
- **Total Playtime**: Highlights your most invested games.
- **Release Date**: Chronological ordering by original release year.
- **Install Size**: Identify which titles are consuming the most disk capacity.
- **User / Metacritic Rating**: Discover your highest-rated titles.

## Drive & Platform Grouping
- Toggle **Group by Drive** to visually divide your library into sections corresponding to each physical drive or partition (e.g., \`C:\\\`, \`D:\\\`, \`E:\\\`).
- Toggle **Group by Store** to separate your Steam, GOG, and DRM-free collections into distinct collapsible shelves.`,
      },
      {
        id: "managing",
        categoryId: "library",
        title: "Favorites, Hidden & Tags",
        summary: "Organize your backlog, pin favorites, add custom tags, and hide unwanted titles.",
        badge: "core",
        icon: Tag,
        keywords: ["favorites", "hidden", "tags", "backlog", "notes", "rating"],
        relatedIds: ["library", "bulk-actions", "gamedetails"],
        body: `Keep your library tidy and focus on the games you actually want to play.

## Favorites Shelf
- Click the **Star / Heart** icon on any game tile to add it to your Favorites.
- Favorited games are pinned to a dedicated shelf at the very top of your library and sidebar for immediate access.

## Hidden Games
- Own utility software, benchmark tools, or games you will never play again? Right-click the tile and select **Hide Game**.
- Hidden games are completely removed from normal grid and list views without uninstalling any files from disk.
- To view or unhide games, toggle **Show Hidden Games** in the sidebar filter toolbox.

## Custom Tags & Backlog Status
- Assign custom tags (e.g. \`Short\`, \`LAN Party\`, \`Replay\`, \`Spooky\`).
- Mark play status: **Backlog**, **Playing**, **Completed**, or **Abandoned** to track your gaming journey.`,
      },
      {
        id: "bulk-actions",
        categoryId: "library",
        title: "Bulk Operations & Batch Editing",
        summary: "Multi-select games with Ctrl and Shift to batch favorite, tag, hide, or refresh metadata.",
        badge: "proTip",
        icon: Sparkles,
        keywords: ["bulk", "batch", "multi-select", "ctrl-click", "mass edit"],
        relatedIds: ["managing", "filters"],
        body: `Managing individual games one-by-one can be slow for large libraries. GameIndex includes comprehensive multi-select bulk operations.

## How to Multi-Select
- Hold **\`Ctrl\`** (or **\`Cmd\`**) and click tiles to select multiple individual games.
- Hold **\`Shift\`** and click two tiles to select the entire range of games between them.
- A floating **Bulk Action Bar** will slide up at the bottom of the screen.

## Available Bulk Operations
- **Bulk Favorite / Unfavorite**: Add or remove all selected games from your favorites shelf.
- **Bulk Tag**: Add or remove custom tags across all selected games simultaneously.
- **Bulk Hide / Unhide**: Clean up your library view in one click.
- **Batch Metadata Refresh**: Re-query IGDB and SteamGridDB to fetch fresh covers, ratings, and player counts.
- **Bulk Uninstall / Remove**: Remove shortcuts or launch uninstallers sequentially.`,
      },
      {
        id: "updates",
        categoryId: "library",
        title: "Version Tracking & Updates",
        summary: "Automatic detection of newer game versions and update notification badges.",
        badge: "guide",
        icon: Sparkles,
        keywords: ["updates", "versions", "badge", "patch", "outdated", "build"],
        relatedIds: ["library", "downloads"],
        body: `GameIndex tracks installed game versions against current release manifests to let you know when patches or newer builds are available.

## Update Indicators
- When a newer version is identified, an **Update Available** accent badge appears on the top-right corner of the game tile.
- Clicking the badge opens the version comparison dialog showing your installed version string versus the latest detected release notes and build number.
- You can filter your library by **"Has Update"** to review all games with pending updates at a glance.`,
      },
    ],
  },

  // ── 4. Game Details & Launching ──────────────────────────────────────────
  {
    id: "game-details",
    title: "Game Details & Launching",
    description: "Launch options, pre/post scripts, artwork scrapers, HowLongToBeat stats, and media.",
    icon: Gamepad2,
    subcategories: [
      {
        id: "gamedetails",
        categoryId: "game-details",
        title: "Game Details & Customization",
        summary: "Live Steam player counts, HowLongToBeat completion times, ProtonDB tier, and specs.",
        badge: "core",
        icon: Gamepad2,
        keywords: ["details", "overview", "player count", "howlongtobeat", "protondb", "specs"],
        relatedIds: ["launch-config", "custom-artwork", "reviews-media"],
        body: `Clicking any game in your library opens its comprehensive **Game Hub**.

## Information Displayed
- **Hero Banner & Logo**: High-definition wide banner with crisp transparent title logo.
- **Live Steam Concurrent Players**: Real-time count of active players worldwide.
- **HowLongToBeat**: Estimated hours for Main Story, Main + Extra, and 100% Completionist playthroughs.
- **ProtonDB Badge (Linux/Deck)**: Native, Platinum, Gold, Silver, Bronze, or Borked rating.
- **Metacritic & Steam Reviews**: Aggregated scores and recent sentiment summary.
- **System Requirements**: Minimum and Recommended CPU, GPU, RAM, and storage specifications.
- **Related Games**: Franchise prequels, sequels, and DLC expansions.`,
      },
      {
        id: "launch-config",
        categoryId: "game-details",
        title: "Custom Launch Options & Elevation",
        summary: "Command-line arguments, custom working directories, Run as Administrator, and launch pickers.",
        badge: "guide",
        icon: Terminal,
        keywords: ["launch options", "arguments", "runas", "admin", "working directory", "elevation"],
        relatedIds: ["hooks-scripts", "gamedetails"],
        body: `Fine-tune how each executable starts with custom launch configurations.

## Configuring Launch Options
1. Open the game page and click **Edit Game** (or right-click the game tile).
2. Switch to the **Launch Options** tab.

## Available Settings
- **Executable Path**: Change or re-link the target binary.
- **Command-Line Arguments**: Pass parameters like \`-novid\`, \`-fullscreen\`, \`-dx11\`, or custom server IPs.
- **Working Directory**: Specify a custom root folder for games that require assets relative to a specific directory.
- **Run as Administrator (\`runas\`)**: Elevate permissions via UAC for legacy games that write saves to \`Program Files\`.
- **Multiple Executable Profiles**: Add secondary binaries (e.g. Map Editor, Mod Configuration Utility, DirectX 11 vs DirectX 12).`,
      },
      {
        id: "hooks-scripts",
        categoryId: "game-details",
        title: "Pre & Post-Launch Scripts",
        summary: "Run companion tools, screen resolution switchers, controller remappers, and cleanup scripts.",
        badge: "proTip",
        icon: Cpu,
        keywords: ["hooks", "scripts", "pre-launch", "post-launch", "companion", "automation"],
        relatedIds: ["launch-config", "telemetry"],
        body: `Automate your gaming environment with pre-launch and post-launch process hooks.

## Pre-Launch Hooks
Execute commands, batch files (\`.bat\`), PowerShell scripts (\`.ps1\`), or shell scripts before the game launches:
- Launch companion overlays (e.g. SpecialK, RTSS, JoyToKey).
- Switch monitor resolution or refresh rate (e.g. via \`QRes.exe\`).
- Mount virtual drives or encrypted save containers.

## Post-Launch Hooks
Automatically trigger cleanups when the game process terminates:
- Restore desktop resolution and multi-monitor configurations.
- Sync save files to a private cloud or backup directory.
- Terminate companion processes to save system memory.`,
      },
      {
        id: "custom-artwork",
        categoryId: "game-details",
        title: "Artwork Scraper & Drag-and-Drop",
        summary: "Scrape posters, heroes, logos, and icons from SteamGridDB/IGDB or drag images directly onto the page.",
        badge: "guide",
        icon: Palette,
        keywords: ["artwork", "covers", "steamgriddb", "igdb", "drag and drop", "logo", "hero"],
        relatedIds: ["gamedetails", "reviews-media"],
        body: `Make your library look breathtaking with custom artwork and logos.

## Built-In Scrapers
- GameIndex integrates with **SteamGridDB**, **IGDB**, and **LaunchBox** to find official and community-made artwork.
- Click **Edit Game → Media** to browse alternative covers, including animated APNG / WebP covers, retro box art, and minimalist variants.

## Instant Drag-and-Drop
- Want to use your own image? Simply drag any \`.png\`, \`.jpg\`, or \`.webp\` file from your file explorer directly onto the game page!
- Dropzones for **Cover Poster**, **Hero Banner**, and **Title Logo** will illuminate automatically. Drop the image, and GameIndex caches it locally immediately.`,
      },
      {
        id: "reviews-media",
        categoryId: "game-details",
        title: "Reviews, Media & Web Previews",
        summary: "High-resolution screenshot viewer, official trailers, Steam reviews, and web link previews.",
        badge: "core",
        icon: Monitor,
        keywords: ["reviews", "screenshots", "trailers", "media", "web links", "steam reviews"],
        relatedIds: ["gamedetails", "custom-artwork"],
        body: `Explore trailers, gameplay screenshots, and player feedback without leaving GameIndex.

## Media Tabs
- **Screenshots**: High-resolution gallery with full-screen zoom and slideshow navigation.
- **Trailers & Gameplay**: Watch official YouTube and Steam video trailers embedded seamlessly.
- **Steam Community Reviews**: Read verified owner reviews with helpfulness sorting, language filtering, and review sentiment graphs.
- **Web Links**: Quick access to official wikis, PCGamingWiki, Speedrun.com, and Discord servers. Links open in a clean in-app preview overlay.`,
      },
    ],
  },

  // ── 5. Discovery, Deals & News ───────────────────────────────────────────
  {
    id: "discovery",
    title: "Discovery, Deals & News",
    description: "IGDB store catalog, side-by-side game comparison, live deals aggregator, and gaming RSS.",
    icon: Store,
    subcategories: [
      {
        id: "store",
        categoryId: "discovery",
        title: "Discovering Games (Store)",
        summary: "Trending, Top Rated, and Anticipated upcoming titles with typo-tolerant search.",
        badge: "core",
        icon: Store,
        keywords: ["store", "igdb", "catalog", "trending", "search", "discovery"],
        relatedIds: ["game-compare", "deals", "wishlist"],
        body: `The **Store** page connects directly to the Internet Game Database (IGDB) to provide an interactive catalog of over 300,000 video games.

## Curated Rails
- **Trending Now**: Most discussed and active games across the industry this week.
- **Top Rated of All Time**: Critically acclaimed masterpieces sorted by metascore.
- **Upcoming Releases**: Highly anticipated titles with countdown days until launch.
- **Genre Spotlights**: Deep dives into specific categories (e.g. Turn-Based Tactics, Immersive Sims).

## Smart Search 2.0
- Features typo-tolerant matching (e.g. typing \`witchr\` correctly resolves to *The Witcher 3*).
- Shows ownership badges on games you already own in your library so you never accidentally rebuy a game!`,
      },
      {
        id: "game-compare",
        categoryId: "discovery",
        title: "Side-by-Side Game Compare",
        summary: "Compare up to 4 games side by side across ratings, playtime, genres, and platforms.",
        badge: "proTip",
        icon: SlidersHorizontal,
        keywords: ["compare", "comparison", "matrix", "specs", "versus"],
        relatedIds: ["store", "wishlist"],
        body: `Torn between multiple games during a sale? Use the built-in **Comparison Tray**.

## How to Compare Games
1. On any game card in the Store, Library, or Deals page, click the **Compare (+)** icon.
2. Add up to **four games** to the comparison tray pinned at the bottom.
3. Click **Compare Now** to open the side-by-side comparison modal.

## Comparison Criteria
- **User & Critic Ratings**: Side-by-side metascore, user score, and Steam sentiment.
- **Average Length**: HowLongToBeat story vs completionist comparison.
- **Shared & Unique Attributes**: Shared genres, multiplayer modes, engine, and themes.
- **Pricing & Discounts**: Current lowest price across retailers with green winner highlights on the best deals.`,
      },
      {
        id: "deals",
        categoryId: "discovery",
        title: "Deals & Prices",
        summary: "Real-time pricing across major digital retailers and 100% off giveaway countdown timers.",
        badge: "guide",
        icon: BadgePercent,
        keywords: ["deals", "sales", "discounts", "giveaways", "free games", "prices"],
        relatedIds: ["store", "wishlist"],
        body: `The **Deals** page tracks prices across authorized digital storefronts to find the lowest historical prices for PC games.

## Storefronts Tracked
- Steam, GOG, Epic Games Store, Humble Bundle, Fanatical, Green Man Gaming, and Gamesplanet.

## Features
- **Discount Threshold Slider**: Filter to show deals with at least 50%, 75%, or 90% discount.
- **DRM-Free Filter**: Toggle to only display deals for DRM-free copies (GOG / Humble).
- **100% Off Giveaways**: Dedicated alert section tracking active free giveaways (e.g. Epic weekly freebies, Steam promo weekends, Prime Gaming) with live countdown timers until the claim window expires!`,
      },
      {
        id: "wishlist",
        categoryId: "discovery",
        title: "Wishlist & Countdowns",
        summary: "Track upcoming titles, release date countdowns, price alerts, and export shareable cards.",
        badge: "core",
        icon: Heart,
        keywords: ["wishlist", "countdown", "release date", "price alert", "share"],
        relatedIds: ["store", "deals"],
        body: `Never lose track of upcoming games or sales with the unified Wishlist.

## Features
- Add games from the Store, Deals, or Game Details pages with one click.
- **Release Countdowns**: Live ticking countdown timer (days, hours, minutes) for unreleased titles.
- **Discount Badges**: Wishlisted titles automatically display highlighted discount tags when they go on sale.
- **Personal Notes**: Jot down notes (e.g. *"Buy the Deluxe edition during winter sale"*).
- **Export Share Cards**: Generate a sleek, branded image card of your wishlist to share with friends.`,
      },
      {
        id: "news",
        categoryId: "discovery",
        title: "News & RSS Feeds",
        summary: "Built-in RSS reader, curated feed packs, custom RSS/Atom feeds, and distraction-free reader mode.",
        badge: "guide",
        icon: Newspaper,
        keywords: ["news", "rss", "atom", "feed", "patch notes", "articles"],
        relatedIds: ["store"],
        body: `Stay up to date with game patch notes, studio announcements, and industry journalism without leaving your launcher.

## Built-In Reader
- Pre-configured with top gaming feeds: PC Gamer, Rock Paper Shotgun, Eurogamer, Steam News Hub, and IGN.
- Click **Add Feed** to paste any valid RSS or Atom feed URL.
- **Distraction-Free Article View**: Read articles with formatting, headers, and media intact inside the app.
- Tracks unread states per feed so you always know what is new since your last session.`,
      },
    ],
  },

  // ── 6. Activity & Performance ────────────────────────────────────────────
  {
    id: "tracking",
    title: "Activity & Performance",
    description: "Automated session detection, hardware telemetry (FPS/frametime), Gantt charts, and notes.",
    icon: Activity,
    subcategories: [
      {
        id: "activity",
        categoryId: "tracking",
        title: "Activity & Performance Tracking",
        summary: "How GameIndex detects running processes via WMI / proc polling and logs session lifecycles.",
        badge: "core",
        icon: Activity,
        keywords: ["sessions", "wmi", "process", "tracking", "playtime", "poller"],
        relatedIds: ["telemetry", "session-notes"],
        body: `GameIndex accurately logs every gaming session without requiring you to launch games strictly from within the app.

## How Detection Works
- **Windows**: GameIndex uses low-overhead Windows Management Instrumentation (WMI) and Win32 process event polling. When an exe launches, GameIndex matches the process ID (PID) to your library entries.
- **Linux**: Scans \`/proc\` process trees to monitor wine/proton subprocesses and native binaries.
- **Smart Polling**: A lightweight 5-second background poller checks whether the game process is still active. When the process terminates, GameIndex calculates exact playtime, records telemetry metrics, and writes the session to SQLite (\`sessions\` table).

> [!NOTE]
> Even if you launch a game directly from a desktop shortcut or Steam, GameIndex will detect it and track your session!`,
      },
      {
        id: "telemetry",
        categoryId: "tracking",
        title: "Hardware Telemetry: FPS & Frametime",
        summary: "Connecting MSI Afterburner / RTSS on Windows or MangoHud / GameScope on Linux.",
        badge: "guide",
        icon: Cpu,
        keywords: ["telemetry", "fps", "frametime", "rtss", "afterburner", "mangohud", "gpu"],
        relatedIds: ["activity", "session-notes"],
        body: `Track performance metrics to identify frame drops, thermal throttling, and hardware bottlenecks.

## Windows: RTSS / MSI Afterburner
- GameIndex connects to the RivaTuner Statistics Server (RTSS) shared memory pipeline.
- Captures real-time **Average FPS**, **1% Low FPS**, **0.1% Low FPS**, and **Frametime variance**.
- Ensure RTSS or MSI Afterburner is running in the background before launching a game.

## Linux: MangoHud & GameScope
- GameIndex automatically reads MangoHud CSV telemetry logs and GameScope statistics.
- Simply toggle **Enable MangoHud** in **Game Details → Compatibility** — no extra configuration needed!`,
      },
      {
        id: "session-notes",
        categoryId: "tracking",
        title: "Session Notes & Gaming Diary",
        summary: "Keep a personal diary of achievements, boss defeats, hardware tweaks, and progression notes.",
        badge: "guide",
        icon: BookOpen,
        keywords: ["notes", "diary", "journal", "bosses", "milestones", "progress"],
        relatedIds: ["activity", "telemetry"],
        body: `Turn your gaming history into a personal chronicle with Session Notes.

## Adding Notes
- When a game session ends, a subtle prompt allows you to jot down quick notes.
- Or open **Activity → Sessions**, click any past session row, and add or edit your notes.

## Ideas for Session Notes
- *"Defeated Malenia after 42 attempts using bloodhound step."*
- *"Upgraded GPU drivers to 555.85 — fixed stutter in Novigrad."*
- *"Completed Chapter 4 with Sarah in co-op mode."*
- Notes are searchable and included in your \`.gibak\` data backups.`,
      },
    ],
  },

  // ── 7. Achievements & Social ─────────────────────────────────────────────
  {
    id: "achievements",
    title: "Achievements & Community",
    description: "Unified achievements from Steam/GOG/RetroAchievements, manual unlocks, and local social.",
    icon: Trophy,
    subcategories: [
      {
        id: "achievements",
        categoryId: "achievements",
        title: "Achievements Hub & Gamerscore",
        summary: "Aggregated unlocks across Steam, GOG, Epic, and RetroAchievements into a unified Gamerscore.",
        badge: "core",
        icon: Trophy,
        keywords: ["achievements", "gamerscore", "trophy", "rarity", "completionist", "100%"],
        relatedIds: ["manual-unlocks", "community"],
        body: `The **Achievements** hub brings all your triumphs across PC and retro platforms together.

## Aggregation Sources
- **Steam**: Synced via the official Steam Web API.
- **GOG & Epic**: Synced via client local state.
- **RetroAchievements**: Connect your RetroAchievements account to track achievements for NES, SNES, PS1, GBA, and Arcade titles!

## Features
- **Gamerscore Calculation**: Points awarded based on achievement rarity (Common, Rare, Ultra-Rare).
- **100% Perfect Ribbons**: Showcase games where you unlocked every single achievement.
- **Unlock Activity Heatmap**: GitHub-style activity grid showing your daily achievement unlocks over the past year.`,
      },
      {
        id: "manual-unlocks",
        categoryId: "achievements",
        title: "Manual & Local Save Unlocks",
        summary: "Manual achievement editing for DRM-free games and parsing local emulator save files.",
        badge: "guide",
        icon: Sparkles,
        keywords: ["manual", "unlock", "emulator save", "drm-free achievements", "retroachievements"],
        relatedIds: ["achievements"],
        body: `Play DRM-free games or offline emulators? GameIndex lets you track achievements even when no online storefront is attached.

## Manual Unlocks
- Link any manual executable to a public Steam AppID in **Edit Game → Achievements**.
- Manually check off achievements as you earn them in-game.

## Local Save Parsing
- GameIndex can parse achievement saves on disk from supported emulator cores and standalone wrappers, unlocking achievements automatically as your save file progresses.`,
      },
      {
        id: "community",
        categoryId: "achievements",
        title: "Community & Friends",
        summary: "Local-first social system, friend presence, library overlap comparison, and encrypted direct messaging.",
        badge: "guide",
        icon: Users,
        keywords: ["friends", "social", "presence", "messaging", "chat", "library compare"],
        relatedIds: ["achievements"],
        body: `Connect with your gaming circle using GameIndex's optional, local-first social features.

## Core Features
- **Friend Presence**: See what games your friends are currently playing in real time.
- **Library Overlap**: Compare your library against a friend's profile to discover mutual co-op and multiplayer titles you both own.
- **Direct Messaging**: Lightweight, end-to-end encrypted direct messaging with read receipts.
- **Zero Corporate Surveillance**: All presence relaying is opt-in and decentralized. Disable social features at any time in **Settings → Privacy & Data**.`,
      },
    ],
  },

  // ── 8. Downloads & Storage ───────────────────────────────────────────────
  {
    id: "downloads-storage",
    title: "Downloads & Storage",
    description: "Concurrent downloads (HTTP, Debrid, Torrents), bandwidth caps, and drive space relocation.",
    icon: HardDrive,
    subcategories: [
      {
        id: "downloads",
        categoryId: "downloads-storage",
        title: "Downloads Manager",
        summary: "Direct HTTP with resume, Debrid services (Real-Debrid, AllDebrid, TorBox), and torrents via librqbit.",
        badge: "core",
        icon: Download,
        keywords: ["downloads", "http", "debrid", "real-debrid", "torbox", "torrents", "librqbit"],
        relatedIds: ["torrent-controls", "storage"],
        body: `GameIndex features a high-performance, concurrent download manager that handles multiple transfer protocols in a single unified queue.

## Supported Protocols
- **Direct HTTP/HTTPS**: Multi-connection accelerated downloading with pause, resume, and integrity checksum verification.
- **Debrid Services**: Native integration for **Real-Debrid**, **AllDebrid**, and **TorBox**. Enter your API token in **Settings → Downloads** for high-speed premium link generation and instant torrent cache checks.
- **Torrents & Magnets**: Built-in native BitTorrent engine powered by \`librqbit\` — no third-party client (like qBittorrent) required!

> [!TIP]
> The in-app web browser automatically captures download links and routes them straight into the GameIndex downloads engine!`,
      },
      {
        id: "torrent-controls",
        categoryId: "downloads-storage",
        title: "Torrent & Bandwidth Controls",
        summary: "Per-file selection, seed ratios, global bandwidth throttling, and peer connection limits.",
        badge: "guide",
        icon: SlidersHorizontal,
        keywords: ["torrents", "bandwidth", "speed limit", "seeding", "peers", "ratio"],
        relatedIds: ["downloads", "storage"],
        body: `Fine-tune your network usage with comprehensive torrent and bandwidth settings.

## Torrent Options
- **Per-File Selection**: Choose exactly which files inside a multi-file torrent to download.
- **Seeding Controls**: Set automatic stop conditions based on seed ratio (e.g. stop at 1.0 or 2.0 ratio) or seeding time.
- **Sequential Download**: Download pieces in order for immediate archive inspection.

## Bandwidth Throttling
- Set global download and upload speed limits in **Settings → Downloads**.
- Schedule speed limits during working hours to prevent gaming downloads from saturating your home connection.`,
      },
      {
        id: "storage",
        categoryId: "downloads-storage",
        title: "Storage Manager",
        summary: "Real mount points, visual usage bars, install size breakdowns, and mod/ROM footprint analysis.",
        badge: "core",
        icon: HardDrive,
        keywords: ["storage", "drives", "disk space", "mount points", "usage", "cleaner"],
        relatedIds: ["relocation", "downloads"],
        body: `Keep your SSDs and NVMe drives healthy with the dedicated **Storage Manager**.

## Drive Overview
- Shows all mounted drives, partitions, and external drives with color-coded visual storage capacity bars.
- Breaks down disk usage into **Games**, **Emulators & ROMs**, **Mods**, and **Other Files**.

## Storage Tools
- **Sort by Size**: Immediately find the 100GB+ titles taking up the most room.
- **Stale Install Detector**: Highlights games you have not launched in over 6 months.
- **Bulk Recalculate**: Re-scans directories on disk to update byte counts after external file modifications.`,
      },
      {
        id: "relocation",
        categoryId: "downloads-storage",
        title: "One-Click Game Relocation",
        summary: "Move game installations between physical drives with automatic path re-linking.",
        badge: "proTip",
        icon: ArchiveRestore,
        keywords: ["move", "relocate", "transfer", "drives", "ssd", "re-link"],
        relatedIds: ["storage"],
        body: `Running out of space on your high-speed NVMe drive? Move games to secondary storage in seconds.

## How to Relocate a Game
1. Open the **Storage Manager** and locate the game you wish to move.
2. Click **Move Installation**.
3. Select your target destination drive (e.g. \`E:\\Games\`).
4. GameIndex copies all game files, verifies file integrity, deletes the old directory, and updates the executable path in SQLite automatically.

> [!IMPORTANT]
> The game remains fully launchable with all save files and launch arguments intact. You never need to reinstall or reconfigure shortcuts!`,
      },
    ],
  },

  // ── 9. Emulators & Modding ───────────────────────────────────────────────
  {
    id: "emulators-mods",
    title: "Emulators & Modding",
    description: "Retro console platforms, ROM scanning, save state backups, and dual-pane mod manager.",
    icon: MonitorPlay,
    subcategories: [
      {
        id: "emulators",
        categoryId: "emulators-mods",
        title: "Emulators & ROMs",
        summary: "Platform profiles, linking emulator executables, catalog of known emulators, and BIOS checks.",
        badge: "setup",
        icon: MonitorPlay,
        keywords: ["emulators", "retro", "retroarch", "dolphin", "pcsx2", "rpcs3", "bios"],
        relatedIds: ["rom-management", "save-states"],
        body: `The **Emulators** hub turns GameIndex into an all-in-one retro gaming station.

## Supported Platforms
- NES, SNES, N64, GameCube, Wii, Switch, Game Boy, GBA, DS, 3DS, PS1, PS2, PS3, PSP, Sega Genesis, Dreamcast, and Arcade.

## Configuration
1. Open **Emulators → Platforms**.
2. Select a console (e.g. *PlayStation 2*) and point GameIndex to your emulator binary (e.g. \`pcsx2.exe\` or RetroArch core).
3. **BIOS Verification**: GameIndex checks your configured BIOS directory to ensure required firmware files are present before you launch.`,
      },
      {
        id: "rom-management",
        categoryId: "emulators-mods",
        title: "ROM Scanning & Disc Stacking",
        summary: "Scanning ROM folders, clean name identification, multi-disc stacking, and box art scraping.",
        badge: "guide",
        icon: HardDrive,
        keywords: ["roms", "scanning", "disc stacking", "m3u", "box art", "retro"],
        relatedIds: ["emulators", "save-states"],
        body: `Effortlessly organize thousands of retro ROMs without messy clutter.

## Smart ROM Scanning
- Point GameIndex to your ROM folders (\`.iso\`, \`.chd\`, \`.bin/.cue\`, \`.z64\`, \`.rvz\`, \`.nsp\`).
- Automatically cleans ugly filenames (removes \`[U] [!] (Rev 1)\` tags) and matches official titles.
- Fetches authentic 3D box art, cartridge art, and original manual scans.

## Disc Stacking
- Multi-disc games (e.g. *Final Fantasy VII Disc 1, 2, 3*) are automatically collapsed into a single library entry with an in-game disc switcher dropdown.`,
      },
      {
        id: "save-states",
        categoryId: "emulators-mods",
        title: "Save State & Snapshot Manager",
        summary: "Listing, snapshotting, backing up, and restoring emulator save states.",
        badge: "guide",
        icon: ArchiveRestore,
        keywords: ["saves", "save states", "snapshots", "backup saves", "restore"],
        relatedIds: ["emulators", "rom-management"],
        body: `Never lose hours of retro progress to corrupted memory cards or accidental state overwrites.

## Features
- Detects native emulator memory cards and state slots.
- **Instant Snapshot**: Take a named snapshot of your save state with one click.
- **Rollback & Restore**: Revert to previous boss checkpoints or earlier story chapters at any time.
- Save files are automatically included in full GameIndex system backups.`,
      },
      {
        id: "mods",
        categoryId: "emulators-mods",
        title: "Mod Manager",
        summary: "Dual-pane mod manager for Steam Workshop and Nexus Mods, load-order, and conflicts.",
        badge: "core",
        icon: Puzzle,
        keywords: ["mods", "mod manager", "steam workshop", "nexus mods", "load order", "conflicts"],
        relatedIds: ["gamedetails", "launch-config"],
        body: `Manage game modifications with a clean, dual-pane mod manager.

## Integrations
- **Steam Workshop**: Browse, subscribe, and download workshop items directly within GameIndex.
- **Nexus Mods**: Connect your Nexus Mods API key to browse endorsed mods, track updates, and download archive packages.

## Features
- **Load Order Management**: Drag and drop active mods to reorder priority.
- **Conflict Detection**: Highlights mods that overwrite the same game files and warns you before launching.
- **Disk Footprint**: See exactly how many gigabytes your mod folder consumes per title.`,
      },
    ],
  },

  // ── 10. Linux & Steam Deck ───────────────────────────────────────────────
  {
    id: "linux-deck",
    title: "Linux & Steam Deck",
    description: "Proton/Wine runners, prefix management, DXVK/VKD3D flags, and GameScope handheld tuning.",
    icon: Terminal,
    subcategories: [
      {
        id: "compatibility",
        categoryId: "linux-deck",
        title: "Linux & Steam Deck",
        summary: "Detecting and downloading Steam Proton, GE-Proton, Wine-GE, and CachyOS runners in-app.",
        badge: "linux",
        icon: Terminal,
        keywords: ["linux", "proton", "wine", "ge-proton", "wine-ge", "runners", "steam deck"],
        relatedIds: ["prefixes", "graphics-flags", "steam-deck"],
        body: `On Linux and SteamOS, GameIndex provides a complete compatibility suite for running Windows titles effortlessly.

## Runner Auto-Detection
GameIndex automatically scans and recognizes all installed compatibility runners on your system:
- Official Steam Proton (Proton 9.0, Proton Experimental, Proton Hotfix).
- Community GE-Proton builds (\`~/.local/share/Steam/compatibilitytools.d\`).
- Wine-GE, Lutris runners, and system Wine.

## In-App Runner Downloader
- Go to **Settings → Proton / Wine**.
- Download the latest **GE-Proton** releases directly within GameIndex with one click! GameIndex extracts the tarball to your compatibility directory and refreshes the runner list immediately.`,
      },
      {
        id: "prefixes",
        categoryId: "linux-deck",
        title: "Wine Prefixes & Tools",
        summary: "Per-game wine prefixes, prefix cloning, launching winecfg, regedit, and winetricks verbs.",
        badge: "linux",
        icon: Settings,
        keywords: ["prefixes", "wine prefix", "winecfg", "regedit", "winetricks", "compatdata"],
        relatedIds: ["compatibility", "graphics-flags"],
        body: `Manage Wine prefixes (virtual Windows C: environments) with granular control.

## Prefix Modes
- **Per-Game Prefix (Recommended)**: Keeps dependencies, saves, and registry isolated per title.
- **Shared Default Prefix**: Saves disk space by grouping compatible titles together.
- **Steam Compatdata Reuse**: Points GameIndex to use an existing Steam \`compatdata/<appid>\` prefix.

## Built-In Wine Tools
From any game's **Compatibility** tab, launch standard Windows management utilities with one click:
- **Wine Configuration (\`winecfg\`)**: Configure Windows version (Win 10/11), audio drivers, and display settings.
- **Registry Editor (\`regedit\`)**: Inspect or modify virtual Windows registry keys.
- **Winetricks Verbs**: Install common runtimes (\`vcrun2022\`, \`dotnet48\`, \`d3dx9\`, \`corefonts\`) without terminal commands.`,
      },
      {
        id: "graphics-flags",
        categoryId: "linux-deck",
        title: "Graphics & Performance Flags",
        summary: "DXVK, VKD3D, esync, fsync, ntsync, async, Wayland, WoW64, and GPU pinning.",
        badge: "linux",
        icon: Cpu,
        keywords: ["dxvk", "vkd3d", "fsync", "esync", "ntsync", "gpu pinning", "wayland"],
        relatedIds: ["compatibility", "steam-deck"],
        body: `Achieve maximum framerates and lowest input latency with toggleable graphics and kernel options.

## Performance Toggles
- **DXVK & VKD3D**: Translates DirectX 9/10/11 and DirectX 12 calls to high-performance Vulkan.
- **Kernel Synchronization**: Toggles for **Fsync**, **Esync**, and modern **Ntsync** for stutter-free multithreading.
- **DXVK Async**: Compile shaders asynchronously to eliminate shader compilation stutter.
- **Wayland Native**: Run games without XWayland translation overhead on modern compositors.

## GPU Pinning for Laptops & Multi-GPU
- On laptops with hybrid graphics (Intel/AMD iGPU + NVIDIA dGPU), select your dedicated GPU in the dropdown. GameIndex injects the appropriate Vulkan and PRIME environment variables automatically.`,
      },
      {
        id: "steam-deck",
        categoryId: "linux-deck",
        title: "Steam Deck & GameScope Tuning",
        summary: "GameScope FSR upscaling, resolution scaling, FPS limit, HDR, and MangoHud overlays.",
        badge: "linux",
        icon: MonitorPlay,
        keywords: ["steam deck", "steamos", "gamescope", "fsr", "hdr", "mangohud", "handheld"],
        relatedIds: ["compatibility", "graphics-flags"],
        body: `GameIndex runs natively on SteamOS and the Steam Deck desktop and game modes.

## GameScope Integration
Configure Valve's micro-compositor directly inside GameIndex:
- **AMD FSR Upscaling**: Render at 720p or 540p and upscale to 800p/1080p with sharpening filters.
- **FPS Limiter & Refresh Rate**: Cap framerate to 30, 40, 45, or 60 FPS for optimal battery longevity.
- **HDR & Adaptive Sync**: Enable High Dynamic Range on Steam Deck OLED and variable refresh rate monitors.

## MangoHud Overlay
- Enable the lightweight MangoHud performance overlay with preset density levels (battery, FPS counter, full telemetry graph).`,
      },
    ],
  },

  // ── 11. Interface, Themes & Customization ─────────────────────────────────
  {
    id: "customization",
    title: "Interface, Themes & Backups",
    description: "Navigation tab reordering, curated color themes, custom accents, and portable backups.",
    icon: Palette,
    subcategories: [
      {
        id: "interface",
        categoryId: "customization",
        title: "Interface & Visibility",
        summary: "Drag-and-drop top navigation tabs, setting inline tab limits, and Simple vs Complete UI modes.",
        badge: "core",
        icon: SlidersHorizontal,
        keywords: ["interface", "tabs", "reorder", "simple ui", "complete ui", "visibility"],
        relatedIds: ["themes-styling", "backup"],
        body: `Customize GameIndex so that only the tools you care about are on screen.

## Drag-and-Drop Tab Reordering
- Open **Settings → Interface**.
- Use the grip handle to drag top-nav tabs into whatever order you prefer.
- Configure how many tabs stay inline before the **More** dropdown menu activates.

## Simple UI vs Complete UI
- **Simple UI Mode**: Hides power-user tabs (Emulators, Mods, Storage) for a streamlined, minimalist launcher experience.
- **Complete UI Mode**: Displays every tool, widget, and diagnostic graph.`,
      },
      {
        id: "themes-styling",
        categoryId: "customization",
        title: "Themes, Accent & Aesthetics",
        summary: "8+ curated color themes, custom accent color picker, light mode, and motion toggles.",
        badge: "core",
        icon: Palette,
        keywords: ["themes", "accent color", "dark mode", "light mode", "nord", "cyberpunk", "aurora"],
        relatedIds: ["interface"],
        body: `Express your aesthetic taste with GameIndex's design system.

## Curated Themes
- **Default Dark**: Refined slate and obsidian dark mode.
- **Nord**: Cool arctic blues and frosted twilight slate.
- **Cyberpunk**: High-contrast neon cyan and magenta accents.
- **Aurora**: Emerald greens and deep boreal midnight tones.
- **Sunset**: Warm amber and rose quartz hues.
- **Monokai**: Vibrant developer-inspired warm contrasts.
- **Light Mode**: Crisp, high-contrast daylight theme designed for bright rooms.

## Custom Accent Color
- Choose any custom HEX or RGB accent color. GameIndex dynamically recalculates glow values, border mixes, and contrast text colors in real time!`,
      },
      {
        id: "backup",
        categoryId: "customization",
        title: "Backup & Restore",
        summary: "Exporting your entire setup into a portable .gibak archive with Merge and Replace options.",
        badge: "core",
        icon: ArchiveRestore,
        keywords: ["backup", "restore", "gibak", "export", "import", "migration", "ndjson"],
        relatedIds: ["interface", "database-internals"],
        body: `Migrate your entire library, playtime history, and custom artwork to a new PC in one step.

## Creating a Backup
1. Go to **Settings → Backup & Restore**.
2. Select the domains to include: Games, Playtime Sessions, Achievements, Wishlist, Notes, Mods, and Custom Artwork.
3. Click **Create Backup**. GameIndex packages your data into a compressed **\`.gibak\`** archive.

## Restoring a Backup
- **Merge Mode**: Adds the archive's games and history into your current machine without overwriting existing entries.
- **Replace Mode**: Performs a clean restoration, clearing local state before restoring the backup.

> [!NOTE]
> Backups include your configurations and artwork, but not the multi-gigabyte game install folders themselves.`,
      },
      {
        id: "bigscreen",
        categoryId: "customization",
        title: "Big Picture Mode",
        summary: "Controller-first 10-foot TV experience, animated SteamGridDB backdrops, and couch navigation.",
        badge: "core",
        icon: Monitor,
        keywords: ["big screen", "controller", "tv", "gamepad", "couch", "fullscreen"],
        relatedIds: ["shortcuts", "interface"],
        body: `Big Screen turns GameIndex into a couch-friendly, controller-first interface.

## Getting Around
- Enter with the monitor button or \`F11\` / \`Ctrl+B\`; leave with \`Escape\` or the B button.
- Rails and grids respond to the D-pad, stick and arrow keys. Rails wrap end-to-start and grids flow to the next row.
- GameIndex remembers the focused card per page, so returning to Library drops you exactly where you left off.
- Animated SteamGridDB backdrops cross-fade behind dashboards and game heroes.`,
      },
      {
        id: "tips",
        categoryId: "customization",
        title: "Tips & Tricks",
        summary: "Small habits and power moves that make GameIndex feel blazing fast.",
        badge: "proTip",
        icon: Sparkles,
        keywords: ["tips", "tricks", "power moves", "secrets", "workflow"],
        relatedIds: ["shortcuts", "commandpalette"],
        body: `Small habits that make GameIndex feel fast.

## Power Moves
- \`Ctrl+K\` for everything: navigate, search, run actions, do math.
- Right-click game tiles for the full context menu; hover for quick actions.
- Drag images onto a game page to set artwork instantly.
- Save **filter presets** for the few library views you actually use.
- Use the **compare tray** before a sale purchase to see which edition wins.
- Hide games you're done with instead of deleting them — they stay searchable.
- On Linux, download a GE-Proton runner and set it as the default; most games just work.
- Back up before big changes: it takes seconds and covers every config domain.`,
      },
    ],
  },

  // ── 12. Troubleshooting & Reference ──────────────────────────────────────
  {
    id: "reference",
    title: "Troubleshooting & Reference",
    description: "Complete keyboard and controller shortcuts cheatsheet, common error fixes, and SQLite internals.",
    icon: HelpCircle,
    subcategories: [
      {
        id: "shortcuts",
        categoryId: "reference",
        title: "Keyboard & Controller Shortcuts",
        summary: "Complete reference for desktop keyboard hotkeys and Big Screen controller button mappings.",
        badge: "reference",
        icon: Keyboard,
        keywords: ["shortcuts", "hotkeys", "keybinds", "controller", "gamepad", "f11", "ctrl+k"],
        relatedIds: ["troubleshooting", "commandpalette"],
        body: `Quick reference for all navigation and control shortcuts across GameIndex.

## Desktop Keyboard Shortcuts
| Shortcut | Action |
| :--- | :--- |
| **\`Ctrl+K\`** / **\`Cmd+K\`** | Open Command Palette from anywhere |
| **\`F11\`** / **\`Ctrl+B\`** | Toggle Big Screen 10-foot mode |
| **\`/\`** | Focus search input on Store, Storage, Docs, and Downloads |
| **\`Escape\`** | Close active modal, clear search, or exit Big Screen |
| **\`G\`** / **\`L\`** | Switch between Grid View and List View |
| **\`Arrow Keys\`** | Navigate between grid tiles and table rows |
| **\`Enter\`** | Open focused game or activate selected action |
| **\`1\` to **\`4\`** | Switch sub-tabs on the Activity page |

## Big Screen Gamepad Mappings
| Button (Xbox / PlayStation) | Action |
| :--- | :--- |
| **D-Pad / Left Stick** | Spatial navigation across grids and rails |
| **A / Cross** | Select focused item or Launch Game |
| **B / Circle** | Go Back / Close overlay |
| **X / Square** | Toggle Favorite on selected game |
| **Y / Triangle** | Open Game Details page |
| **Start / Menu** | Open Quick Options context menu |
| **LB / RB** | Cycle top navigation tabs |`,
      },
      {
        id: "troubleshooting",
        categoryId: "reference",
        title: "Common Problems & Solutions",
        summary: "Store sync failures, games failing to start, missing FPS metrics, and storage permissions.",
        badge: "guide",
        icon: AlertTriangle,
        keywords: ["troubleshooting", "error", "crash", "sync failed", "permissions", "faq"],
        relatedIds: ["shortcuts", "database-internals"],
        body: `Solutions to frequently encountered issues and troubleshooting steps.

## Store Sync Failures
- **Steam Sync Returns 0 Games**: Verify your Steam profile and game details privacy settings are set to **Public**.
- **GOG Cookie Expired**: Re-open **Settings → Integrations → GOG** and click **Connect GOG** to refresh your session cookie.

## Game Launches But Fails to Start
- **UAC Elevation Required**: If the game requires administrator rights, edit the game in GameIndex and toggle **Run as Administrator**.
- **Missing DirectX / Visual C++**: Run the game's official prerequisites installer located in its \`_CommonRedist\` directory.

## FPS / Telemetry Not Showing
- On Windows, ensure **RivaTuner Statistics Server (RTSS)** is running and has permission to hook 64-bit and 32-bit processes.
- On Linux, verify that **MangoHud** is installed via your package manager (\`sudo pacman -S mangohud\` or \`flatpak install mangohud\`).`,
      },
      {
        id: "database-internals",
        categoryId: "reference",
        title: "Database Architecture & Data Safety",
        summary: "Where gamelib.db is stored, SQLite WAL mode, data backups, and manual repair.",
        badge: "reference",
        icon: Database,
        keywords: ["database", "sqlite", "wal", "gamelib.db", "storage path", "data safety"],
        relatedIds: ["backup", "troubleshooting"],
        body: `Learn where your data lives and how GameIndex ensures transaction safety.

## Database Location
Your SQLite database file (\`gamelib.db\`) is stored in your OS application data directory:
- **Windows**: \`%APPDATA%\\GameIndex\\gamelib.db\`
- **Linux**: \`~/.config/GameIndex/gamelib.db\`
- **macOS**: \`~/Library/Application Support/GameIndex/gamelib.db\`

## Reliability Features
- **WAL Mode (Write-Ahead Logging)**: Prevents write locks from blocking read queries and guarantees ACID transaction safety even if the app process terminates unexpectedly.
- **Automatic Schema Migrations**: Handled through append-only migration scripts (\`schema_vN.sql\`). Old schemas are automatically upgraded without data loss.`,
      },
    ],
  },
];

export const QUICK_START_CARDS: QuickStartCard[] = [
  {
    id: "qs-welcome",
    subcategoryId: "welcome",
    titleKey: "docs.qs.welcome.title",
    descKey: "docs.qs.welcome.desc",
    defaultTitle: "Overview & Architecture",
    defaultDesc: "Local-first SQLite architecture, privacy, and supported stores.",
    badge: "Core",
    icon: Rocket,
  },
  {
    id: "qs-firststeps",
    subcategoryId: "firststeps",
    titleKey: "docs.qs.firststeps.title",
    descKey: "docs.qs.firststeps.desc",
    defaultTitle: "3-Minute Setup",
    defaultDesc: "Step-by-step checklist to connect stores and import games.",
    badge: "Setup",
    icon: Compass,
  },
  {
    id: "qs-steam",
    subcategoryId: "steam",
    titleKey: "docs.qs.steam.title",
    descKey: "docs.qs.steam.desc",
    defaultTitle: "Connect Steam",
    defaultDesc: "Web API Key setup, playtime sync, and achievements.",
    badge: "Stores",
    icon: Store,
  },
  {
    id: "qs-shortcuts",
    subcategoryId: "shortcuts",
    titleKey: "docs.qs.shortcuts.title",
    descKey: "docs.qs.shortcuts.desc",
    defaultTitle: "Shortcuts Cheatsheet",
    defaultDesc: "Master Ctrl+K, Big Screen mode, and controller mappings.",
    badge: "Reference",
    icon: Keyboard,
  },
  {
    id: "qs-troubleshooting",
    subcategoryId: "troubleshooting",
    titleKey: "docs.qs.troubleshooting.title",
    descKey: "docs.qs.troubleshooting.desc",
    defaultTitle: "Troubleshooting",
    defaultDesc: "Quick fixes for store sync, game launches, and telemetry.",
    badge: "Help",
    icon: HelpCircle,
  },
];

/** Flattened list of all subcategories */
export const ALL_SUBCATEGORIES: DocSubcategory[] = DOC_CATEGORIES.flatMap(
  (c) => c.subcategories
);

/** Helper to find a category by its subcategory id */
export function findCategoryBySubId(subId: string): DocCategory | undefined {
  return DOC_CATEGORIES.find((c) => c.subcategories.some((s) => s.id === subId));
}

/** Helper to find a subcategory by id */
export function findSubcategoryById(id: string): DocSubcategory | undefined {
  return ALL_SUBCATEGORIES.find((s) => s.id === id);
}
