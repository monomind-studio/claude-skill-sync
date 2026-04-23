# Claude Skill Sync

Obsidian 插件 — 把 Obsidian vault 作为 AI agent skill 的中央仓库，一键 symlink 到 Claude Code / Codex / Cursor 等工具的 skill 目录，跨电脑同步交给 vault 自身的 sync 方案。

> 配套理念：**单一真身（vault），多处替身（symlink）**。任何位置编辑都即时一致，不复制内容、不占额外空间。

![架构图](docs/architecture.png)

> 详细使用指南：[docs/USAGE.md](docs/USAGE.md)

## 安装

### 方式 A：开发者本地（推荐）

```bash
# 1. clone 到本地任意位置
git clone https://github.com/<owner>/claude-skill-sync.git ~/Documents/claude-skill-sync

# 2. 在你的 Obsidian vault 里建 symlink 指向它
cd /path/to/your-vault
ln -s ~/Documents/claude-skill-sync .obsidian/plugins/claude-skill-sync

# 3. 启动 Obsidian → 设置 → 第三方插件 → 关闭安全模式 → 启用 Claude Skill Sync
```

升级：`cd ~/Documents/claude-skill-sync && git pull`，然后在 Obsidian 里重新加载插件即可。

### 方式 B：直接复制（最简）

把整个目录复制到 vault 内：

```bash
git clone https://github.com/<owner>/claude-skill-sync.git \
  /path/to/your-vault/.obsidian/plugins/claude-skill-sync
```

## 启用后

1. 设置 → Claude Skill Sync 中确认：
   - **Vault 内 Skill 根目录**（默认 `Skills`，可改成你 vault 里的实际路径，如 `SkillPack/skills`）
   - **目标平台**（默认 Claude Code + Codex/Agents，可加任意）
2. 左侧 ribbon 点插头图标打开侧边栏
3. 在 vault 的 skill 根目录下放 skill（每个子目录 = 一个 skill，含 `SKILL.md`）
4. 点"全部安装"——所有 skill symlink 到本机平台目录，AI 工具立即可用

## 功能

- **侧边栏状态卡**：8 格 grid 显示已同步 / 部分同步 / 未安装 / 待导入 / 指向错误 / 失效 link / 冲突
- **双向同步**：vault → 平台（install）+ 平台 → vault（import 向导）
- **失效 link 一键清理**：vault 删了 skill，残留的 symlink 一键扫掉
- **指向错误一键修复**：vault 路径变了，所有 symlink 一键改指
- **定时自动同步**（默认 5 分钟）：vault 新 skill 自动安装；平台新真目录默认仅提醒、可选自动导入
- **启动状态提醒**：打开 Obsidian 弹通知摘要

## 工作机制

```
vault/<skillRoot>/<name>/   ← 真身（数据）
              ▲
              │ symlink
              │
~/.claude/skills/<name>     ← 替身
~/.agents/skills/<name>     ← 替身
~/.cursor/skills/<name>     ← 替身（自行添加平台）
```

所有 AI 工具读取的是同一份内容，跨工具立即一致。

## 跨电脑同步

vault 通过 Obsidian Sync / iCloud / Git / 坚果云等任意方案同步真身；每台电脑上的"替身"由本插件本地建立。

`data.json`（每机平台路径）应当**不参与跨机同步**（含 `~`，不同电脑展开后不同；本仓库 `.gitignore` 已忽略）。

## 平台支持

- ✅ macOS / Linux / Windows 桌面端
- ❌ 移动端（iOS/Android Obsidian 无 Node fs / symlink 能力，插件 `isDesktopOnly: true`）

## 配置示例

`data.json`（首次启用后自动生成；勿提交至 git）：

```json
{
  "skillRoot": "SkillPack/skills",
  "platforms": [
    { "name": "Claude Code", "target": "~/.claude/skills", "enabled": true },
    { "name": "Codex / Agents", "target": "~/.agents/skills", "enabled": true },
    { "name": "Cursor", "target": "~/.cursor/skills", "enabled": false }
  ],
  "notifyOnStartup": true,
  "autoScanIntervalMin": 5,
  "autoInstall": true,
  "autoImport": false
}
```

## 开发

纯 JS，无 build。改 `main.js` → Obsidian 设置里关掉再开启插件即可。

```
.
├── manifest.json   # 插件元信息
├── main.js         # 全部逻辑（~770 行）
├── styles.css      # 侧边栏样式
├── data.json       # 用户本地设置（gitignore）
└── README.md
```

## License

MIT — 见 LICENSE
