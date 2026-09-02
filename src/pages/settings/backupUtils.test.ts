import { describe, it, expect } from "vitest";
import { formatBackupBytes } from "./backupUtils";

describe("formatBackupBytes", () => {
  it("formats plain bytes without a suffix", () => {
    expect(formatBackupBytes(0)).toBe("0 B");
    expect(formatBackupBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatBackupBytes(1024)).toBe("1.0 KB");
  });

  it("formats megabytes and gigabytes", () => {
    expect(formatBackupBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBackupBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("keeps one decimal and does not roll into TB", () => {
    expect(formatBackupBytes(10 * 1024 * 1024 * 1024)).toBe("10.0 GB");
    // No TB unit defined — larger sizes stay in GB.
    expect(formatBackupBytes(1024 * 1024 * 1024 * 1024)).toBe("1024.0 GB");
  });
});