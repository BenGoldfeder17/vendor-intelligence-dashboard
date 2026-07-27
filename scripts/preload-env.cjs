/**
 * env.yaml → process.env, executed BEFORE any application module loads.
 *
 * Usage (already wired into package.json and the Dockerfile):
 *     node -r ./scripts/preload-env.cjs server.js
 *
 * WHY A PRELOAD AND NOT AN IMPORT:
 * `src/config/app.config.ts` reads process.env at module-evaluation time, and it
 * is imported by client components for display labels — so it cannot do
 * filesystem work itself. A `-r` preload runs in Node before anything else, which
 * makes the ordering deterministic on every platform. With `output: "standalone"`
 * a build-time load would bake values into the image, which is wrong for secrets.
 *
 * FORMAT — deliberately the flat map Cloud Run's --env-vars-file accepts:
 *     KEY: value
 *     KEY: "value with: colons or # hashes"
 *     # comment
 * Nested maps are unsupported because Cloud Run rejects them. Structured values
 * (vendor contracts) travel as a JSON string in a single key.
 *
 * PRECEDENCE: a real environment variable always wins over the file, so an
 * orchestrator or secret manager can override anything without editing it.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FILE = (process.env.ENV_YAML_PATH || "env.yaml").trim();

function parseFlatYaml(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    // Indented lines belong to a nested map. Cloud Run rejects nesting, so we
    // ignore them rather than silently promoting a child key to top level.
    if (/^\s/.test(rawLine) && rawLine.trim()) continue;

    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf(":");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue; // skip nested/odd keys

    let value = line.slice(idx + 1).trim();

    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);

    if (quoted) {
      value = value.slice(1, -1); // verbatim, including # and :
    } else {
      const hash = value.indexOf(" #"); // strip trailing inline comment
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function load() {
  const full = path.isAbsolute(FILE) ? FILE : path.join(process.cwd(), FILE);
  if (!fs.existsSync(full)) return { loaded: false, keys: 0 };

  let keys = 0;
  try {
    const parsed = parseFlatYaml(fs.readFileSync(full, "utf-8"));
    for (const k of Object.keys(parsed)) {
      if (process.env[k] === undefined || process.env[k] === "") {
        process.env[k] = parsed[k];
        keys += 1;
      }
    }
  } catch (e) {
    // Never crash the process on a malformed file — config falls back to
    // defaults and /api/health reports what is missing.
    console.warn("[preload-env] could not read " + full + ": " + e.message);
    return { loaded: false, keys: 0 };
  }
  return { loaded: true, keys };
}

const result = load();
if (process.env.PRELOAD_ENV_VERBOSE === "1") {
  console.log(
    "[preload-env] " + (result.loaded ? "loaded " + result.keys + " key(s) from " + FILE : FILE + " not found")
  );
}

module.exports = { parseFlatYaml, load };
