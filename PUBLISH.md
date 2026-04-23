# 发布到 GitHub + Obsidian 插件商店

> 本指南假设你已安装 `git` 和 `gh`（GitHub CLI），且已 `gh auth login`。

## 一次性准备：替换占位符

发布前先把这些 `<YOUR-...>` 占位符替换成你的真实信息：

```bash
# 在仓库根目录执行（macOS）
cd ~/Documents/claude-skill-sync
sed -i '' 's/<YOUR-NAME>/你的真名/g' manifest.json LICENSE
sed -i '' 's/<YOUR-GITHUB>/你的GitHub用户名/g' manifest.json README.md docs/USAGE.md
```

或者手动编辑：
- `manifest.json` → `author`、`authorUrl`
- `LICENSE` → 版权人姓名
- `README.md` → repo 链接
- `docs/USAGE.md` → repo 链接

## 第一阶段：发布到 GitHub

### 1. 初始化 git 仓库

```bash
cd ~/Documents/claude-skill-sync
git init
git add .
git status     # 确认 data.json 已被 .gitignore 忽略
git commit -m "Initial release v0.1.0"
```

### 2. 在 GitHub 创建公开 repo 并 push

```bash
gh repo create claude-skill-sync --public --source=. --push --description "Manage AI coding agent Skills from your Obsidian vault"
```

或网页创建后：
```bash
git branch -M main
git remote add origin https://github.com/<你的用户名>/claude-skill-sync.git
git push -u origin main
```

### 3. 创建 v0.1.0 Release（**Obsidian 商店硬要求**）

商店审核会从 GitHub Releases 拉取 `manifest.json` / `main.js` / `styles.css`，**tag 名必须等于 manifest.json 的 version，不带 `v` 前缀**。

```bash
gh release create 0.1.0 \
  manifest.json main.js styles.css \
  --title "0.1.0 — 首发版本" \
  --notes-file CHANGELOG.md
```

注意三个 asset 必须直接上传到 release（不是源码 zip 里）。

### 4. 验证 release 可访问

```bash
curl -sI https://github.com/<你的用户名>/claude-skill-sync/releases/download/0.1.0/manifest.json | head -1
# 期望 200 或 302
```

## 第二阶段：提交到 Obsidian 插件商店

### 1. Fork obsidianmd/obsidian-releases

```bash
gh repo fork obsidianmd/obsidian-releases --clone --remote
cd obsidian-releases
```

### 2. 编辑 community-plugins.json，追加你的条目

打开文件，在数组**末尾**追加（注意前一项末尾要补逗号）：

```json
{
  "id": "claude-skill-sync",
  "name": "Claude Skill Sync",
  "author": "<你的真名>",
  "description": "Manage AI coding agent Skills (Claude Code, Codex, Cursor, Gemini, and more) from your Obsidian vault. One source, symlinked to each tool.",
  "repo": "<你的GitHub用户名>/claude-skill-sync"
}
```

`repo` 字段格式必须是 `<owner>/<repo-name>`，不带 https://。

### 3. 提交 PR

```bash
git checkout -b add-claude-skill-sync
git add community-plugins.json
git commit -m "Add Claude Skill Sync plugin"
git push origin add-claude-skill-sync
gh pr create --repo obsidianmd/obsidian-releases \
  --title "Add Claude Skill Sync" \
  --body "Plugin repo: https://github.com/<你的用户名>/claude-skill-sync

Manages AI coding agent Skills from Obsidian vault, symlinked to Claude Code / Codex / Cursor / 18+ tools."
```

### 4. 等待审核

- 自动检查（bot）：通常几分钟内完成，会跑 `manifest.json` 校验、文件存在性、命名规范等
- 人工审核：1-4 周（受 Obsidian 团队的处理速度影响）
- 如果 bot 标红，修复后 push 同分支即可重新触发

## 常见审核问题与修复

| 问题 | 原因 | 修复 |
|---|---|---|
| Release tag 不匹配 | tag 用了 `v0.1.0` 而非 `0.1.0` | `gh release delete v0.1.0` 后用正确 tag 重发 |
| manifest.json not found in release | 上传到 release 时没附 asset | `gh release upload 0.1.0 manifest.json main.js styles.css` |
| `id` 已被占用 | 跟现有插件 id 冲突 | 改一个独特的 id，记得 manifest.json 和商店 PR 都改 |
| 包含 `console.log` | 商店要求 production 代码无调试输出 | 全文搜 `console.` 删除或注释 |
| `data.json` 被提交 | `.gitignore` 没生效 | `git rm --cached data.json && git commit` |
| Description 太长 | > 250 chars 会被警告 | 精简到一句话 |
| innerHTML 用法 | Obsidian 出于 XSS 安全禁止 `innerHTML` | 改用 createEl / setText |

## 后续版本发布流程

```bash
# 1. 改 manifest.json 的 version (如 0.2.0)
# 2. versions.json 加新条目: "0.2.0": "1.4.0"
# 3. CHANGELOG.md 加新版本说明
# 4. 提交并打 tag
git add manifest.json versions.json CHANGELOG.md
git commit -m "Release v0.2.0"
git push

# 5. 创建新 release
gh release create 0.2.0 manifest.json main.js styles.css \
  --title "0.2.0 — 描述" \
  --notes "见 CHANGELOG.md"
```

新版本发布后**不需要再提交 PR 到 obsidian-releases**，商店会自动从你的 GitHub Releases 拉新版。

## 用户安装方式

商店审核通过后，用户可以：
1. Obsidian → 设置 → 第三方插件 → 浏览
2. 搜索 "Claude Skill Sync"
3. Install → Enable

也可以用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 提前预览（无需等审核）：
- 在 BRAT 里 Add Beta Plugin → 输入 `<你的用户名>/claude-skill-sync`
