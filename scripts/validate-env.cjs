#!/usr/bin/env node
/**
 * Validate env.yaml before it reaches a deploy.
 *
 * Catches, in order of how often they bite:
 *   1. Non-string values — YAML 1.1 coerces bare y/Y/n/N/yes/no/on/off/true/false
 *      to booleans and bare digits to numbers. Cloud Run rejects both with an
 *      error that does not name the offending key.
 *   2. Nested maps — Cloud Run's --env-vars-file only accepts a flat map.
 *   3. Malformed VENDOR_CONTRACTS JSON.
 *   4. Configuration combinations that will not work at runtime.
 *
 * Exit 0 = safe. Exit 1 = would fail (or silently misbehave).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FILE = process.env.ENV_YAML_PATH || "env.yaml";
const full = path.isAbsolute(FILE) ? FILE : path.join(process.cwd(), FILE);

const errors = [];
const warnings = [];

if (!fs.existsSync(full)) {
  console.error(`✗ ${FILE} not found.\n  Create it:  cp env.example.yaml env.yaml`);
  process.exit(1);
}

const raw = fs.readFileSync(full, "utf-8");
const lines = raw.split(/\r?\n/);

// YAML 1.1 words that become booleans when unquoted.
const BOOLISH = new Set([
  "y","Y","n","N","yes","Yes","YES","no","No","NO",
  "on","On","ON","off","Off","OFF","true","True","TRUE","false","False","FALSE",
]);

const seen = new Map();

lines.forEach((line, i) => {
  const lineNo = i + 1;

  if (/^\s+\S/.test(line) && line.trim() && !line.trim().startsWith("#")) {
    errors.push(`line ${lineNo}: indented (nested) key — Cloud Run rejects nested maps:\n    ${line.trim()}`);
    return;
  }

  const t = line.trim();
  if (!t || t.startsWith("#")) return;

  const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
  if (!m) return;

  const [, key, rest] = m;
  if (seen.has(key)) warnings.push(`${key} defined twice (lines ${seen.get(key)} and ${lineNo}) — the last wins`);
  seen.set(key, lineNo);

  let value = rest;
  const quoted =
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2);

  if (!quoted) {
    const bare = value.split(" #")[0].trim();
    if (BOOLISH.has(bare)) {
      errors.push(`line ${lineNo}: ${key}: ${bare}  → YAML reads this as a BOOLEAN. Quote it: ${key}: "${bare}"`);
    } else if (bare !== "" && /^-?\d+(\.\d+)?$/.test(bare)) {
      errors.push(`line ${lineNo}: ${key}: ${bare}  → YAML reads this as a NUMBER. Quote it: ${key}: "${bare}"`);
    }
  }
});

// ── secrets must NOT have values in the file ──
// An agent (or anyone) with shell access can read any file the OS user can read.
// Deny-lists stop casual reads, not scripted ones. The guarantee comes from the
// secret not being on the machine — injected from a secret manager instead.
const SECRET_KEYS = [
  "LWA_CLIENT_ID", "LWA_CLIENT_SECRET", "LWA_REFRESH_TOKEN",
  "SNAPSHOT_TOKEN", "VENDOR_CONTRACTS",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
];

lines.forEach((line, i) => {
  const t = line.trim();
  if (!t || t.startsWith("#")) return;
  const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
  if (!m) return;
  const [, key, rest] = m;
  if (!SECRET_KEYS.includes(key)) return;

  let v = rest.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  v = v.split(" #")[0].trim();
  // An empty placeholder is fine and expected. "{}" is an empty contracts map.
  if (v === "" || v === "{}") return;

  errors.push(
    `line ${i + 1}: ${key} has a value in this file.\n` +
    `    Secrets must be injected from a secret manager, not written here.\n` +
    `    See SECRETS.md. Remove the value and inject it at deploy time.`
  );
});

// ── VENDOR_CONTRACTS must be valid JSON ──
const contractsLine = lines.find((l) => l.trim().startsWith("VENDOR_CONTRACTS:"));
if (contractsLine) {
  let v = contractsLine.trim().slice("VENDOR_CONTRACTS:".length).trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  if (v) {
    try {
      const parsed = JSON.parse(v);
      const n = Object.keys(parsed).length;
      if (n === 0) {
        warnings.push("VENDOR_CONTRACTS is empty — every vendor code falls back to CONTRACT_DEFAULT_FLOOR. Codes are mis-ranked wherever real terms differ.");
      } else {
        console.log(`  contracts: ${n} vendor code(s) configured`);
      }
    } catch (e) {
      errors.push(`VENDOR_CONTRACTS is not valid JSON: ${e.message}`);
    }
  }
}

// ── runtime-combination checks ──
const get = (k) => {
  const l = lines.find((x) => x.trim().startsWith(k + ":"));
  if (!l) return "";
  let v = l.trim().slice(k.length + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
};

const driver = get("STORAGE_DRIVER") || "local";
if ((driver === "s3" || driver === "gcs") && !get("STORAGE_BUCKET")) {
  errors.push(`STORAGE_DRIVER is "${driver}" but STORAGE_BUCKET is empty.`);
}
if (driver === "local" && get("DEPLOY_PLATFORM") === "gcp") {
  errors.push('STORAGE_DRIVER "local" on Cloud Run loses ALL state on cold start. Use "gcs".');
}
if (get("WAREHOUSE_ENABLED") === "true" && !get("BQ_PROJECT")) {
  errors.push("WAREHOUSE_ENABLED is true but BQ_PROJECT is empty.");
}
if (!get("SNAPSHOT_TOKEN")) {
  warnings.push("SNAPSHOT_TOKEN is empty — the snapshot endpoint relies solely on your platform's auth layer.");
}

// ── report ──
if (warnings.length) {
  console.log("");
  warnings.forEach((w) => console.log(`  ⚠ ${w}`));
}
if (errors.length) {
  console.error("");
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  console.error(`\n${errors.length} error(s) — fix before deploying.`);
  process.exit(1);
}
console.log(`\n✓ ${FILE} valid — ${seen.size} keys, all string values.`);
