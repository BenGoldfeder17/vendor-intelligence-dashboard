# Publishing this to GitHub

Work top to bottom. Step 1 is the one that cannot be undone after the fact.

---

## 1. Clear the right to publish it — do this first

If this was written **for an employer**, on their time, for their vendor account,
then under most employment agreements and work-for-hire doctrine **your employer
owns the copyright — not you.** Publishing without clearance can be a breach of
contract regardless of how generic the code now looks.

De-branding the code does not change ownership. Neither does rewriting it.

Before pushing:

- Read your employment agreement's IP-assignment and moonlighting clauses.
- Get **written** sign-off from whoever can grant it (manager + legal, or the
  business owner). Email is fine; keep it.
- Confirm who the copyright holder should be — you personally, or the company.
  That name goes in `LICENSE`.

This is not legal advice, and I am not a lawyer — but it is the question that
determines whether the rest of this checklist is even worth doing.

**Also consider whether the domain knowledge is publishable.** The code is
generic, but this repository documents marketplace margin mechanics, suppression
code semantics, and vendor-contract structure. Some of that may be commercially
sensitive or covered by your marketplace agreement even though no company name
appears.

---

## 2. Scan git history for secrets — irreversible if you skip it

`.gitignore` only protects files going forward. **If a credential was ever
committed, it is in the history permanently** and pushing publishes it.

```bash
# anything sensitive ever committed?
git log --all --full-history --oneline -- env.yaml .env '*.pem' '*.key'

# credential-shaped strings anywhere in history
git rev-list --all | while read c; do
  git grep -I -n -E "Atzr\||amzn1\.oa2-cs\.v1\.|AKIA[0-9A-Z]{16}" "$c" 2>/dev/null
done | head
```

If either returns anything:

1. **Rotate those credentials now.** Assume they are compromised. Scrubbing
   history does not un-leak a secret that was pushed anywhere.
2. Then either start a fresh repository with no history (simplest, and usually
   correct for a first publication), or rewrite history with
   [git-filter-repo](https://github.com/newren/git-filter-repo).

Fresh start:

```bash
cd <clean-extracted-copy>
rm -rf .git
git init && git add -A && git commit -m "Initial public release"
```

You lose history; you also guarantee nothing leaks from it.

---

## 3. Licence — already set

`LICENSE` contains the **PolyForm Noncommercial License 1.0.0**, with the
copyright holder set. See [COMMERCIAL.md](COMMERCIAL.md) for the commercial path.

This is **source-available, not open source**. It restricts a field of endeavour
(commercial use), which the OSI definition does not permit. Practical effects:

- GitHub's licence detector shows **"Other"**, not a recognised badge.
- It will not appear in open-source directories or package-manager OSS filters.
- Some developers will not contribute to non-commercially-licensed projects.
- Companies with OSS-only policies cannot adopt it without talking to you —
  which is the point.

If you later want maximum adoption instead, MIT or Apache-2.0 are the swaps.
Note that relicensing only affects future versions: anyone who already obtained
a copy under earlier terms keeps those rights for that version, permanently.

## 4. Pre-flight checks

```bash
# no company identifiers
grep -rin "yourcompany\|your-project-id\|internal-hostname" . --exclude-dir=.git

# no secrets file staged
git status --porcelain | grep -E "env\.yaml|\.env$" && echo "STOP — unstage it"

# builds clean
npm ci && npm run typecheck && npm run build

# config template validates
cp env.example.yaml env.yaml && npm run validate && rm env.yaml
```

Also update the placeholder in `.github/ISSUE_TEMPLATE/config.yml`
(`OWNER/REPO` → your path).

---

## 5. Create and push

```bash
gh repo create vendor-intelligence-dashboard \
  --public \
  --description "Marketplace vendor analytics: silent margin-erosion detection, suppression cost, and ranked triage" \
  --source . --push
```

Without the `gh` CLI: create the repo in the UI, then

```bash
git remote add origin git@github.com:<you>/<repo>.git
git branch -M main
git push -u origin main
```

---

## 6. Configure the repository

**Settings → General**
- Disable Wikis and Projects unless you will use them.

**Settings → Code security**
- Enable **Secret scanning** and **Push protection** (blocks future credential
  commits before they land).
- Enable **Dependabot alerts** and security updates.

**Settings → Branches** — protect `main`
- Require a pull request.
- Require the `build` status check from CI.

**About** (sidebar) — topics:
`amazon`, `sp-api`, `vendor-central`, `ecommerce-analytics`, `nextjs`,
`typescript`, `margin-analysis`, `dashboard`

---

## 7. After publishing

- Watch the first CI run. It typechecks, builds, validates the example config,
  and runs the invariant sweeps.
- Add a screenshot to `README.md` — for a dashboard it does more than any
  paragraph.
- Tag a release: `git tag v1.0.0 && git push --tags`.

---

## What is deliberately not included

- `env.yaml` — gitignored; `env.example.yaml` is the template.
- Any vendor contract terms — `VENDOR_CONTRACTS` ships empty.
- Real project IDs, service accounts, buckets, or URLs.
- `.data/` — local runtime state.
