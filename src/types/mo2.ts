// Mod Organizer 2 TypeScript types mirroring Rust serde models.

export interface Mo2Executable {
  title: string;
  path: string;
  arguments?: string;
}

export interface Mo2Instance {
  id: string;
  name: string;
  instancePath: string;
  moExePath?: string;
  isPortable: boolean;
  gameName?: string;
  gamePath?: string;
  modsDir: string;
  profilesDir: string;
  overwriteDir: string;
  selectedProfile: string;
  profiles: string[];
  customExecutables: Mo2Executable[];
}

export interface Mo2Mod {
  id: string;
  name: string;
  enabled: boolean;
  /** 0-indexed priority in UI (increasing numbers overwrite earlier ones) */
  priority: number;
  isSeparator: boolean;
  isUnmanaged: boolean;
  version?: string;
  author?: string;
  nexusModId?: number;
  nexusDomain?: string;
  category?: string;
  url?: string;
  sizeBytes?: number;
  fileCount?: number;
  path: string;
}

export interface Mo2Plugin {
  name: string;
  enabled: boolean;
  priority: number;
}

export interface Mo2ProfileDetails {
  instancePath: string;
  profileName: string;
  mods: Mo2Mod[];
  plugins: Mo2Plugin[];
  activeModCount: number;
  totalModCount: number;
  activePluginCount: number;
  totalPluginCount: number;
}
