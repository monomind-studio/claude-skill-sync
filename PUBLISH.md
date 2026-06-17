# Publishing to GitHub + the Obsidian Plugin Store

> This guide assumes you have already installed `git` and `gh` (GitHub CLI), and have completed `gh auth login`.

## One-Time Setup: Replace Placeholders

Before publishing, replace the following `<YOUR-...>` placeholders with your actual information:

```bash
# Run from the repository root (macOS)
cd ~/Documents/claude-skill-sync
sed -i '' 's/<YOUR-NAME>/Your Real Name/g' manifest.json LICENSE
sed -i '' 's/<YOUR-GITHUB>/Your GitHub Username/g' manifest.json README.md docs/USAGE.md
```

Alternatively, edit the files manually:

- `manifest.json` → `author`, `authorUrl`
- `LICENSE` → copyright holder name
- `README.md` → repository link
- `docs/USAGE.md` → repository link

---

# Phase 1: Publish to GitHub

## 1. Initialize the Git Repository

```bash
cd ~/Documents/claude-skill-sync
git init
git add .
git status     # Confirm data.json is ignored by .gitignore
git commit -m "Initial release v0.1.0"
```

## 2. Create a Public GitHub Repository and Push

```bash
gh repo create claude-skill-sync --public --source=. --push --description "Manage AI coding agent Skills from your Obsidian vault"
```

Or create the repository through the GitHub website and then run:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/claude-skill-sync.git
git push -u origin main
```

## 3. Create the v0.1.0 Release (**Required for the Obsidian Store**)

The Obsidian plugin review process downloads `manifest.json`, `main.js`, and `styles.css` directly from GitHub Releases.

**The release tag must exactly match the version in `manifest.json` and must NOT include a `v` prefix.**

```bash
gh release create 0.1.0 \
  manifest.json main.js styles.css \
  --title "0.1.0 — Initial Release" \
  --notes-file CHANGELOG.md
```

> Important: The three files must be uploaded as release assets directly, not just included in the source ZIP archive.

## 4. Verify the Release Is Accessible

```bash
curl -sI https://github.com/<your-username>/claude-skill-sync/releases/download/0.1.0/manifest.json | head -1
# Expected result: HTTP 200 or 302
```

---

# Phase 2: Submit to the Obsidian Plugin Store

## 1. Fork the Obsidian Releases Repository

```bash
gh repo fork obsidianmd/obsidian-releases --clone --remote
cd obsidian-releases
```

## 2. Add Your Entry to `community-plugins.json`

Open the file and append the following object to the **end of the array**:

```json
{
  "id": "claude-skill-sync",
  "name": "Claude Skill Sync",
  "author": "<Your Real Name>",
  "description": "Manage AI coding agent Skills (Claude Code, Codex, Cursor, Gemini, and more) from your Obsidian vault. One source, symlinked to each tool.",
  "repo": "<your-github-username>/claude-skill-sync"
}
```

The `repo` field must follow the format:

```text
<owner>/<repo-name>
```

Do not include `https://`.

## 3. Submit a Pull Request

```bash
git checkout -b add-claude-skill-sync
git add community-plugins.json
git commit -m "Add Claude Skill Sync plugin"
git push origin add-claude-skill-sync

gh pr create --repo obsidianmd/obsidian-releases \
  --title "Add Claude Skill Sync" \
  --body "Plugin repo: https://github.com/<your-username>/claude-skill-sync

Manages AI coding agent Skills from Obsidian vault, symlinked to Claude Code / Codex / Cursor / 18+ tools."
```

## 4. Wait for Review

- **Automated checks (bot):** Usually complete within a few minutes. These validate `manifest.json`, required files, naming conventions, and other requirements.
- **Manual review:** Typically takes 1–4 weeks, depending on the Obsidian team's review queue.
- If the bot reports errors, fix the issues and push updates to the same branch to trigger the checks again.

---

# Common Review Issues and Fixes

| Issue | Cause | Fix |
|---------|---------|---------|
| Release tag mismatch | Used `v0.1.0` instead of `0.1.0` | Delete the incorrect release and recreate it with the correct tag |
| `manifest.json` not found in release | Assets were not attached to the release | `gh release upload 0.1.0 manifest.json main.js styles.css` |
| Plugin `id` already exists | Conflicts with an existing plugin | Choose a unique ID and update both `manifest.json` and the store PR |
| Contains `console.log` statements | Production plugins should not contain debug output | Remove or comment out all `console.*` calls |
| `data.json` committed | `.gitignore` not working properly | `git rm --cached data.json && git commit` |
| Description too long | Over 250 characters | Shorten it to a concise sentence |
| Uses `innerHTML` | Obsidian prohibits `innerHTML` for XSS security reasons | Use `createEl()` or `setText()` instead |

---

# Future Release Process

```bash
# 1. Update manifest.json version (e.g., 0.2.0)
# 2. Add a new entry to versions.json:
#    "0.2.0": "1.4.0"
# 3. Update CHANGELOG.md
# 4. Commit and push

git add manifest.json versions.json CHANGELOG.md
git commit -m "Release v0.2.0"
git push

# 5. Create a new release

gh release create 0.2.0 manifest.json main.js styles.css \
  --title "0.2.0 — Description" \
  --notes "See CHANGELOG.md"
```

After your plugin is accepted into the store, **future releases do not require another PR to `obsidian-releases`**. The store will automatically detect and publish updates from your GitHub Releases.

---

# How Users Install the Plugin

Once the plugin has been approved:

1. Open **Obsidian**
2. Go to **Settings → Community Plugins → Browse**
3. Search for **Claude Skill Sync**
4. Click **Install → Enable**

## Early Access via BRAT

Users can also preview the plugin before approval using BRAT:

1. Install the BRAT plugin.
2. Open **BRAT → Add Beta Plugin**
3. Enter:

```text
<your-github-username>/claude-skill-sync
```

This allows installation directly from GitHub without waiting for the official review process.
