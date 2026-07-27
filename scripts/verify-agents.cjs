#!/usr/bin/env node
/**
 * Verify the agent suite is internally consistent and still true of the codebase.
 *
 *     node scripts/verify-agents.cjs
 *
 * The agents are only worth having if their claims are accurate. An agent that
 * says "check src/lib/foo.ts" when that file was renamed is worse than no agent —
 * it sends work down a dead path with false confidence.
 *
 * Checks:
 *   1. Frontmatter present and well-formed; `name` matches the filename
 *   2. Every src/ path an agent references actually exists
 *   3. Every agent name cross-referenced resolves to a real agent
 *   4. AGENTS.md routing table lists every agent, and only real ones
 *   5. Skills reference real agents
 *   6. Rules referenced by agents exist
 *
 * Exit 0 = the suite matches reality. Exit 1 = drift, with the specifics.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const AGENT_DIR = path.join(ROOT, ".claude", "agents");
const SKILL_DIR = path.join(ROOT, ".claude", "skills");
const RULE_DIR = path.join(ROOT, ".claude", "rules");
const INDEX = path.join(ROOT, "AGENTS.md");

const errors = [];
const warnings = [];

function read(p) {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

if (!fs.existsSync(AGENT_DIR)) {
  console.error("✗ .claude/agents not found — run from the repository root.");
  process.exit(1);
}

const agentFiles = fs.readdirSync(AGENT_DIR).filter((f) => f.endsWith(".md"));
const agentNames = new Set(agentFiles.map((f) => f.replace(/\.md$/, "")));

// ── 1. frontmatter ───────────────────────────────────────────────────────────
for (const file of agentFiles) {
  const full = path.join(AGENT_DIR, file);
  const txt = read(full);
  const stem = file.replace(/\.md$/, "");

  const m = /^---\n([\s\S]*?)\n---\n/.exec(txt || "");
  if (!m) {
    errors.push(`${file}: missing YAML frontmatter`);
    continue;
  }
  const fm = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const key of ["name", "description", "tools", "model"]) {
    if (!fm[key]) errors.push(`${file}: frontmatter missing "${key}"`);
  }
  if (fm.name && fm.name !== stem) {
    errors.push(`${file}: frontmatter name "${fm.name}" does not match filename "${stem}"`);
  }
  if (fm.description && fm.description.length < 40) {
    warnings.push(`${file}: description is short (${fm.description.length} chars) — routing accuracy depends on it`);
  }
  const body = txt.slice(m[0].length).trim();
  if (body.length < 500) {
    warnings.push(`${file}: body is thin (${body.length} chars)`);
  }
}

// ── 2. referenced source paths must exist ────────────────────────────────────
const PATH_RE = /(?:^|[\s`"'(])((?:src|scripts|\.github|\.claude)\/[A-Za-z0-9_\-./[\]]*[A-Za-z0-9_\]])/g;

/**
 * Paths used as examples rather than claims. Agents legitimately write things
 * like "src/lib/x.ts importing ./config" to illustrate a mistake — flagging
 * those as drift would train people to ignore this checker.
 */
const PLACEHOLDER = /\/(x|y|foo|bar|baz|thing|example|area|path)\.|\/path\/to\/|<[a-z]+>/i;

function checkPaths(file, txt, label) {
  const seen = new Set();
  let m;
  while ((m = PATH_RE.exec(txt)) !== null) {
    let p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);

    // Directory references (trailing slash) and glob-ish paths are informational.
    if (p.endsWith("/") || p.includes("*")) continue;
    // Dynamic route segments can't be checked literally.
    if (p.includes("[")) continue;
    // Only check things that look like a concrete file.
    if (!/\.(ts|tsx|css|mjs|cjs|json|md|yml|yaml|sh)$/.test(p)) continue;
    // Illustrative placeholders in examples are not claims about the codebase.
    if (PLACEHOLDER.test(p)) continue;

    if (!fs.existsSync(path.join(ROOT, p))) {
      errors.push(`${label} ${file}: references "${p}" which does not exist`);
    }
  }
}

for (const file of agentFiles) checkPaths(file, read(path.join(AGENT_DIR, file)) || "", "agent");
if (fs.existsSync(SKILL_DIR)) {
  for (const f of fs.readdirSync(SKILL_DIR)) checkPaths(f, read(path.join(SKILL_DIR, f)) || "", "skill");
}
if (fs.existsSync(RULE_DIR)) {
  for (const f of fs.readdirSync(RULE_DIR)) checkPaths(f, read(path.join(RULE_DIR, f)) || "", "rule");
}
checkPaths("AGENTS.md", read(INDEX) || "", "index");

// ── 3. cross-referenced agent names must resolve ─────────────────────────────
// Agents refer to each other as `agent-name` in backticks.
const NAME_RE = /`([a-z][a-z0-9-]{3,30})`/g;
const KNOWN_NON_AGENTS = new Set([
  "npm", "git", "gcloud", "aws", "docker", "node", "bash", "grep", "sed", "awk",
  "true", "false", "null", "undefined", "string", "number", "boolean",
  "env-yaml", "package-json", "read", "write", "edit", "glob",
]);

/** CSS class prefixes used in this project — never agent names. */
const CSS_PREFIX = /^(rm|cc|mw|ce|hub|nav|np|sev|btn|ti)-/;

function checkAgentRefs(file, txt, label) {
  const seen = new Set();
  let m;
  while ((m = NAME_RE.exec(txt)) !== null) {
    const name = m[1];
    if (seen.has(name) || KNOWN_NON_AGENTS.has(name)) continue;
    seen.add(name);
    // Only flag things that look like an agent reference: hyphenated, and
    // resembling our naming (word-word).
    if (!/^[a-z]+-[a-z]+$/.test(name)) continue;
    if (name.includes(".") || name.includes("/")) continue;
    if (CSS_PREFIX.test(name)) continue;
    if (!agentNames.has(name)) {
      // Could be a legitimate hyphenated term; warn rather than fail.
      warnings.push(`${label} ${file}: \`${name}\` looks like an agent reference but no such agent exists`);
    }
  }
}
for (const file of agentFiles) checkAgentRefs(file, read(path.join(AGENT_DIR, file)) || "", "agent");
if (fs.existsSync(SKILL_DIR)) {
  for (const f of fs.readdirSync(SKILL_DIR)) checkAgentRefs(f, read(path.join(SKILL_DIR, f)) || "", "skill");
}

// ── 4. AGENTS.md routing table must be complete and correct ──────────────────
const index = read(INDEX);
if (!index) {
  errors.push("AGENTS.md not found");
} else {
  for (const name of agentNames) {
    if (!index.includes(`\`${name}\``)) {
      errors.push(`AGENTS.md: routing table is missing agent "${name}"`);
    }
  }
  // Any agent named in the table that no longer exists
  const tableRefs = [...index.matchAll(/^\|\s*`([a-z][a-z0-9-]+)`/gm)].map((m) => m[1]);
  for (const ref of tableRefs) {
    if (!agentNames.has(ref)) {
      errors.push(`AGENTS.md: routing table lists "${ref}" but .claude/agents/${ref}.md does not exist`);
    }
  }
  const declared = /agents\/\s+(\d+)\s+scoped subagents/.exec(index);
  if (declared && Number(declared[1]) !== agentFiles.length) {
    errors.push(`AGENTS.md: says ${declared[1]} agents, but there are ${agentFiles.length}`);
  }
}

// ── 5. rules referenced must exist ───────────────────────────────────────────
const ruleFiles = fs.existsSync(RULE_DIR) ? new Set(fs.readdirSync(RULE_DIR)) : new Set();
const RULE_REF = /rules\/([0-9A-Za-z_-]+\.md)/g;
for (const file of [...agentFiles.map((f) => [f, AGENT_DIR]), ...(fs.existsSync(SKILL_DIR) ? fs.readdirSync(SKILL_DIR).map((f) => [f, SKILL_DIR]) : [])]) {
  const [name, dir] = file;
  const txt = read(path.join(dir, name)) || "";
  let m;
  while ((m = RULE_REF.exec(txt)) !== null) {
    if (!ruleFiles.has(m[1])) {
      errors.push(`${name}: references rules/${m[1]} which does not exist`);
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`Agent suite: ${agentFiles.length} agents, ${ruleFiles.size} rules, ` +
            `${fs.existsSync(SKILL_DIR) ? fs.readdirSync(SKILL_DIR).length : 0} skills`);

if (warnings.length) {
  console.log("");
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
if (errors.length) {
  console.error("");
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\n${errors.length} inaccuracy(ies) — the agents no longer match the codebase.`);
  process.exit(1);
}
console.log("\n✓ Every agent claim checks out against the codebase.");
