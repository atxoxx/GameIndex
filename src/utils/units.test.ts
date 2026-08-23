import { describe, it, expect } from "vitest";
import { formatSize } from "../types/game";
import { formatBytesPerSecond, formatBytesShort } from "../types/download";
import { setActiveLocale } from "../i18n";

describe("formatSize", () => {
  it("formats decimal GB and binary GiB in English", () => {
    expect(formatSize(1_000_000_000, "gb", "en")).toBe("1.0 GB");
    expect(formatSize(1_500_000_000, "gb", "en")).toBe("1.5 GB");
    expect(formatSize(1_073_741_824, "gib", "en")).toBe("1.0 GiB");
    expect(formatSize(2_147_483_648, "gib", "en")).toBe("2.0 GiB");
  });

  it("formats decimal Go and binary Gio in French", () => {
    expect(formatSize(1_000_000_000, "gb", "fr")).toBe("1.0 Go");
    expect(formatSize(15_000_000_000, "gb", "fr")).toBe("15.0 Go");
    expect(formatSize(1_073_741_824, "gib", "fr")).toBe("1.0 Gio");
    expect(formatSize(0, "gb", "fr")).toBe("0.0 Go");
    expect(formatSize(0, "gib", "fr")).toBe("0.0 Gio");
  });

  it("formats decimal ГБ and binary ГиБ in Russian", () => {
    expect(formatSize(1_000_000_000, "gb", "ru")).toBe("1.0 ГБ");
    expect(formatSize(1_073_741_824, "gib", "ru")).toBe("1.0 ГиБ");
  });
});

describe("formatBytesPerSecond (speed metrics)", () => {
  describe("Decimal Bytes/s mode (bytes)", () => {
    it("formats English decimal units (B/s, KB/s, MB/s, GB/s)", () => {
      expect(formatBytesPerSecond(0, "bytes", "en")).toBe("0 B/s");
      expect(formatBytesPerSecond(500, "bytes", "en")).toBe("500 B/s");
      expect(formatBytesPerSecond(1_500, "bytes", "en")).toBe("1.50 KB/s");
      expect(formatBytesPerSecond(12_500_000, "bytes", "en")).toBe("12.5 MB/s");
      expect(formatBytesPerSecond(125_000_000, "bytes", "en")).toBe("125 MB/s");
      expect(formatBytesPerSecond(1_500_000_000, "bytes", "en")).toBe("1.50 GB/s");
    });

    it("formats French decimal units (o/s, ko/s, Mo/s, Go/s)", () => {
      expect(formatBytesPerSecond(0, "bytes", "fr")).toBe("0 o/s");
      expect(formatBytesPerSecond(850, "bytes", "fr")).toBe("850 o/s");
      expect(formatBytesPerSecond(2_500, "bytes", "fr")).toBe("2.50 ko/s");
      expect(formatBytesPerSecond(15_400_000, "bytes", "fr")).toBe("15.4 Mo/s");
      expect(formatBytesPerSecond(2_000_000_000, "bytes", "fr")).toBe("2.00 Go/s");
    });

    it("formats Russian decimal units (Б/с, КБ/с, МБ/с, ГБ/с)", () => {
      expect(formatBytesPerSecond(0, "bytes", "ru")).toBe("0 Б/с");
      expect(formatBytesPerSecond(15_000_000, "bytes", "ru")).toBe("15.0 МБ/с");
    });
  });

  describe("Binary Bytes/s mode (binary / gib)", () => {
    it("formats English binary units (B/s, KiB/s, MiB/s, GiB/s)", () => {
      expect(formatBytesPerSecond(0, "binary", "en")).toBe("0 B/s");
      expect(formatBytesPerSecond(1024, "binary", "en")).toBe("1.00 KiB/s");
      expect(formatBytesPerSecond(1024 * 1024 * 15, "binary", "en")).toBe("15.0 MiB/s");
      expect(formatBytesPerSecond(1024 * 1024 * 1024 * 2.5, "binary", "en")).toBe("2.50 GiB/s");
    });

    it("formats French binary units (o/s, Kio/s, Mio/s, Gio/s)", () => {
      expect(formatBytesPerSecond(0, "binary", "fr")).toBe("0 o/s");
      expect(formatBytesPerSecond(1024, "binary", "fr")).toBe("1.00 Kio/s");
      expect(formatBytesPerSecond(1024 * 1024 * 15, "binary", "fr")).toBe("15.0 Mio/s");
      expect(formatBytesPerSecond(1024 * 1024 * 1024 * 3, "binary", "fr")).toBe("3.00 Gio/s");
    });
  });

  describe("Network Bits/s mode (bits)", () => {
    it("formats bits with 8x conversion and 1000 telecom divisor", () => {
      // 0 bytes/s -> 0 bit/s
      expect(formatBytesPerSecond(0, "bits", "en")).toBe("0 bit/s");

      // 125,000 bytes/s * 8 = 1,000,000 bits/s = 1.00 Mbit/s
      expect(formatBytesPerSecond(125_000, "bits", "en")).toBe("1.00 Mbit/s");

      // 12.5 MB/s (12,500,000 bytes/s) * 8 = 100,000,000 bits/s = 100 Mbit/s
      expect(formatBytesPerSecond(12_500_000, "bits", "en")).toBe("100 Mbit/s");

      // 125,000,000 bytes/s * 8 = 1,000,000,000 bits/s = 1.00 Gbit/s
      expect(formatBytesPerSecond(125_000_000, "bits", "en")).toBe("1.00 Gbit/s");
    });

    it("formats bits in Russian (Мбит/с, Гбит/с)", () => {
      expect(formatBytesPerSecond(0, "bits", "ru")).toBe("0 бит/с");
      expect(formatBytesPerSecond(12_500_000, "bits", "ru")).toBe("100 Мбит/с");
    });
  });

  describe("Global active locale integration", () => {
    it("uses activeLocale when lang is omitted", () => {
      setActiveLocale("fr");
      expect(formatBytesPerSecond(10_000_000, "bytes")).toBe("10.0 Mo/s");
      expect(formatSize(5_000_000_000, "gb")).toBe("5.0 Go");

      setActiveLocale("en");
      expect(formatBytesPerSecond(10_000_000, "bytes")).toBe("10.0 MB/s");
      expect(formatSize(5_000_000_000, "gb")).toBe("5.0 GB");
    });
  });
});

describe("formatBytesShort (file size formatting)", () => {
  it("formats decimal file sizes in English and French", () => {
    expect(formatBytesShort(500, "gb", "en")).toBe("500 B");
    expect(formatBytesShort(500_000, "gb", "en")).toBe("500 KB");
    expect(formatBytesShort(25_000_000, "gb", "en")).toBe("25.0 MB");
    expect(formatBytesShort(50_000_000_000, "gb", "en")).toBe("50.0 GB");

    expect(formatBytesShort(500, "gb", "fr")).toBe("500 o");
    expect(formatBytesShort(500_000, "gb", "fr")).toBe("500 ko");
    expect(formatBytesShort(25_000_000, "gb", "fr")).toBe("25.0 Mo");
    expect(formatBytesShort(50_000_000_000, "gb", "fr")).toBe("50.0 Go");
    expect(formatBytesShort(2_000_000_000_000, "gb", "fr")).toBe("2.00 To");
  });

  it("formats binary file sizes in English and French", () => {
    expect(formatBytesShort(1024, "gib", "en")).toBe("1.00 KiB");
    expect(formatBytesShort(1024 * 1024 * 50, "gib", "en")).toBe("50.0 MiB");
    expect(formatBytesShort(1024 * 1024 * 1024 * 100, "gib", "en")).toBe("100 GiB");

    expect(formatBytesShort(1024, "gib", "fr")).toBe("1.00 Kio");
    expect(formatBytesShort(1024 * 1024 * 50, "gib", "fr")).toBe("50.0 Mio");
    expect(formatBytesShort(1024 * 1024 * 1024 * 100, "gib", "fr")).toBe("100 Gio");
    expect(formatBytesShort(1024 * 1024 * 1024 * 1024 * 2, "gib", "fr")).toBe("2.00 Tio");
  });

  it("formats Russian file sizes", () => {
    expect(formatBytesShort(50_000_000_000, "gb", "ru")).toBe("50.0 ГБ");
    expect(formatBytesShort(1024 * 1024 * 1024 * 50, "gib", "ru")).toBe("50.0 ГиБ");
  });

  it("handles null/undefined/0", () => {
    expect(formatBytesShort(null)).toBe("—");
    expect(formatBytesShort(undefined)).toBe("—");
    expect(formatBytesShort(0)).toBe("—");
  });
});
