# Claude Skill Sync — 使用指南

> Obsidian 插件 + AI Coding 工具的协同管理：把 vault 当中央仓库，所有 AI 工具读到的是同一份 skill。

## 架构图

![架构图](./architecture.png)

> 源文件：[architecture.excalidraw](./architecture.excalidraw)
> 在 [excalidraw.com](https://excalidraw.com) 打开 → Open → 选择该文件即可编辑。
> 导出 PNG：在 excalidraw.com 里 Menu → Export image → PNG，覆盖 `architecture.png` 后 commit 即可在 README 里渲染。

## 30 秒理解

- vault 内 `SkillPack/skills/<name>/` 是 skill **真身**（数据本体，唯一一份）
- `~/.claude/skills/<name>` `~/.agents/skills/<name>` 等是 **替身**（symlink，指向真身）
- 跨电脑：vault 同步把真身推到另一台机；另一台机点插件「全部安装」自动建好替身
- 任何位置编辑都即时一致 — Obsidian 改、Claude Code 立刻看到

## 安装（4 步）

### 1. clone 插件 repo

```bash
git clone https://github.com/<owner>/claude-skill-sync.git ~/Documents/claude-skill-sync
```

### 2. 在 vault 里建 skill 中央目录

```bash
mkdir -p /path/to/your-vault/SkillPack/skills
```

> 目录名可改，默认是 `Skills/`，本指南推荐用 `SkillPack/skills/`（便于和文档放一起）。

### 3. 把插件 symlink 到 vault 的 .obsidian/plugins/

```bash
cd /path/to/your-vault
ln -s ~/Documents/claude-skill-sync .obsidian/plugins/claude-skill-sync
```

> 用 symlink 而不是 cp：之后 `git pull` 升级插件，所有 vault 一起生效。

### 4. 在 Obsidian 启用

1. 设置 → 第三方插件 → **关闭安全模式**
2. 启用 **Claude Skill Sync**
3. 设置面板里把 **Vault 内 Skill 根目录**改成你的实际路径（如 `SkillPack/skills`）

## 日常使用

### 添加一个新 skill

```bash
mkdir -p /path/to/your-vault/SkillPack/skills/my-new-skill
```

在该目录里创建 `SKILL.md`：

```markdown
---
name: my-new-skill
description: 一句话描述这个 skill 干嘛
---

# my-new-skill

详细内容...
```

回到 Obsidian 侧边栏点「全部安装」（或等 5 分钟自动同步），所有 AI 工具立刻可用。

### 添加新平台

设置 → Claude Skill Sync → 「+ 添加平台」按钮，弹窗里选预设：

- Claude Code, Codex / Agents, Cursor, Gemini CLI, Qwen Code, Windsurf, Trae / Trae CN
- Junie, Factory Droid, Augment, OpenCode, KiloCode, Qoder, OB1, Amp, Kiro, CodeBuddy
- 自定义（点底部「+ 自定义平台」展开）

### 跨电脑同步

**新机首次接入**：
1. vault 同步软件（Obsidian Sync / iCloud / Git / 坚果云 / Remotely Save）拉下 vault
2. 按上面安装步骤 1+3+4（不需要重新建 SkillPack/skills/，sync 已经带过来了）
3. 启用插件后状态卡显示「48 未安装」，点「全部安装」即完成

**日常**：
- A 电脑添加新 skill → vault sync 推到云 → B 电脑拉到 → B 电脑插件 5 分钟内自动安装（默认开启）

## 侧边栏功能

**顶部**：
- 「刷新」「全部安装」「导入现有」三个按钮
- 中央目录路径显示

**同步状态卡**（8 格 grid）：
| 格子 | 含义 | 点击行为 |
|---|---|---|
| vault skill (×N 平台) | vault 内 skill 数 | — |
| 已同步 | 在所有启用平台都装好的数 | — |
| 部分同步 | 只装了部分平台 | 全部安装补齐 |
| 未安装 | 一个平台都没装 | 全部安装 |
| 待导入 | 平台目录有真目录、vault 无 | 开导入向导 |
| 指向错误 | symlink 指向其他位置 | 修复全部 |
| 失效 link | symlink 指向已不存在 | 一键清理 |
| 冲突 | 平台目录有同名真目录 | 需手动处理 |

**搜索框**：按 skill 名 / description 即时过滤

**skill 列表**（默认收起 description）：
- 每行：`▸ skill-name` + 各平台徽章 + 操作按钮（安装 / 移除 / 改指向）
- 点 ▸ 三角或 name 行展开 description

## 设置项详解

### 启动时提醒同步状态（默认 ON）
打开 Obsidian 后 1.5 秒扫一遍，发现不一致弹通知。

### 定时扫描间隔（默认 5 分钟，0 = 关）
后台轮询。修改即时生效。

### 自动安装新 skill (vault → 平台)（默认 ON，安全）
扫描时发现 vault 新 skill 没装到平台 → 自动建 symlink。

### 自动导入新 skill (平台 → vault)（默认 OFF，⚠️ 危险）
扫描时发现平台目录有新真目录 → 自动 mv 进 vault。
**mv 不可逆**，仅当确定平台目录不会被其他工具临时使用时才开。

## 安全护栏

| 行为 | 保护 |
|---|---|
| 卸载 / 移除 | 只删 symlink，检测目标不是 symlink 拒绝执行 |
| 全部安装 | 跳过冲突状态（同名真目录），不会覆盖 |
| 导入现有 | 用 `fs.rename` 原子操作，跨设备失败立刻报告 |
| 清理失效 | 只删孤儿 symlink，不动真目录 |
| 自动同步 | install 默认开（安全），import 默认关（危险） |

## 常见问题

**Q：状态卡数字不对？**
A：点「刷新」或在设置里修正 skillRoot 路径。

**Q：换电脑后所有 symlink 都「指向错误」？**
A：vault 路径变了。点「指向错误」格子一键 repair，自动按当前 vault 路径重建。

**Q：移动设备能用吗？**
A：不能。iOS/Android Obsidian 没有 Node fs / symlink 能力，插件 `isDesktopOnly: true`。但 vault 里的 skill 文档你仍然可以在手机上**阅读和编辑**，回到桌面端再 install。

**Q：插件升级怎么做？**
A：`cd ~/Documents/claude-skill-sync && git pull`，回 Obsidian 设置里关掉再开启 Claude Skill Sync 即重载。

**Q：data.json 要不要提交 git？**
A：**不要**。它含本机 home 路径，每台电脑展开后不同；本仓库 `.gitignore` 已忽略。

**Q：vault 同步把 .obsidian/ 排除了，插件怎么办？**
A：插件本来就是每台电脑独立 `git clone` + `ln -s`。vault 同步只负责真身（`SkillPack/skills/`）。

## 反馈

- Issue: <https://github.com/&lt;owner&gt;/claude-skill-sync/issues>
- 详细原理：[../docs/流程与原理.md](https://github.com/&lt;owner&gt;/skill-pack-data) （如果你也共享了 SkillPack 数据 repo）
