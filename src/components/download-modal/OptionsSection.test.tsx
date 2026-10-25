import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OptionsSection } from "./OptionsSection";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => {
      if (key === "downloadModal.cacheCached") {
        return "En cache · instantané";
      }
      return key;
    },
  }),
}));

const baseProps = {
  autoExtract: true,
  onAutoExtract: () => {},
  chooseFiles: false,
  onChooseFiles: () => {},
  onSelectFiles: () => {},
  isFetchingFiles: false,
  isDirect: false,
  useDebrid: false,
  onUseDebrid: () => {},
  debridAvailable: true,
} as const;

describe("OptionsSection", () => {
  it("keeps the full cache status in a title while the badge can truncate", () => {
    const { container } = render(
      <OptionsSection {...baseProps} cacheStatus="cached" />,
    );

    const badge = container.querySelector(".dl-cache-badge");
    const text = container.querySelector(".dl-cache-badge-text");

    expect(text?.textContent).toBe("En cache · instantané");
    expect(badge?.getAttribute("title")).toBe("En cache · instantané");
  });

  it("toggles the debrid option", () => {
    const onUseDebrid = vi.fn();
    render(
      <OptionsSection {...baseProps} cacheStatus="idle" onUseDebrid={onUseDebrid} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /downloadModal.useDebrid/i }));
    expect(onUseDebrid).toHaveBeenCalledWith(true);
  });
});
