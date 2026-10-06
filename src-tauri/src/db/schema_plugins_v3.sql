-- =====================================================================
-- Gamelib persistent storage — plugins domain, v3 migration.
-- =====================================================================
-- Stores the full parsed plugin manifest as compact JSON so the
-- frontend can render plugin metadata (icon, homepage, config fields,
-- capabilities) without re-evaluating the sandbox on every list call.
-- Written on install and refreshed whenever a plugin is loaded/toggled;
-- legacy rows default to '' and are surfaced as an empty manifest.

ALTER TABLE plugins ADD COLUMN manifest_json TEXT NOT NULL DEFAULT '';
