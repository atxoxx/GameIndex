-- Append-only migration for the games domain (v15):
-- additional launch executables the user configured for a game.
-- Each entry is a JSON object: { path, label?, arguments?, runAsAdmin? }.
ALTER TABLE games ADD COLUMN extra_executables_json TEXT;
