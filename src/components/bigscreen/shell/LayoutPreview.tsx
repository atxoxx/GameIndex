// Schematic preview of an interface layout.
//
// Drawn from the layout's own traits (nav placement, home composition,
// card shape) so the selector always mirrors the real interface without
// shipping screenshots.

import type { BigScreenPresetId } from "../../../bigscreen/presets";

export default function LayoutPreview({ id }: { id: BigScreenPresetId }) {
  return (
    <span className="bst-preview" data-preview={id} aria-hidden="true">
      <span className="bst-preview-nav">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="bst-preview-hero" />
      <span className="bst-preview-copy">
        <i />
        <i />
      </span>
      <span className="bst-preview-cards">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="bst-preview-dock">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
