import { describe, it, expect, beforeEach } from "vitest";
import { driveOf } from "./utils";
import { publishMounts, mountPointOf, type MountUsage } from "./mounts";

function mount(mountPoint: string, path = mountPoint): MountUsage {
  return {
    path,
    mountPoint,
    device: "/dev/sda1",
    fileSystem: "ext4",
    total: 100,
    free: 50,
    available: 40,
  };
}

describe("driveOf with resolved mounts", () => {
  beforeEach(() => publishMounts([]));

  it("keeps disks under the same parent distinct on Linux", () => {
    publishMounts([
      mount("/run/media/seth/diskA"),
      mount("/run/media/seth/diskB"),
    ]);

    expect(driveOf("/run/media/seth/diskA/Games/Foo")).toBe(
      "/run/media/seth/diskA"
    );
    expect(driveOf("/run/media/seth/diskB/Games/Bar")).toBe(
      "/run/media/seth/diskB"
    );
  });

  it("prefers the longest mount point when mounts nest", () => {
    publishMounts([mount("/"), mount("/home", "/home/seth/Games")]);

    expect(mountPointOf("/home/seth/Games/Foo")).toBe("/home");
    expect(mountPointOf("/opt/games/Foo")).toBe("/");
  });

  it("does not confuse sibling mount prefixes", () => {
    publishMounts([mount("/mnt/data")]);
    expect(mountPointOf("/mnt/data2/game")).toBeNull();
  });
});

describe("driveOf fallback heuristic", () => {
  beforeEach(() => publishMounts([]));

  it("extracts each removable volume on Linux", () => {
    expect(driveOf("/run/media/seth/disk1/Games/Foo")).toBe(
      "/run/media/seth/disk1"
    );
    expect(driveOf("/media/seth/disk2/Games/Foo")).toBe("/media/seth/disk2");
    expect(driveOf("/mnt/data/Games/Foo")).toBe("/mnt/data");
    expect(driveOf("/Volumes/GameDisk/Foo")).toBe("/Volumes/GameDisk");
  });

  it("keeps Windows drive letters", () => {
    expect(driveOf("C:\\Games\\Foo\\bin.exe")).toBe("C:");
    expect(driveOf("d:/steam/foo")).toBe("D:");
  });

  it("returns Unknown for missing paths", () => {
    expect(driveOf(undefined)).toBe("Unknown");
    expect(driveOf("")).toBe("Unknown");
  });
});
