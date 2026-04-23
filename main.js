'use strict';

const obsidian = require('obsidian');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const VIEW_TYPE = 'claude-skill-sync-view';

const PRESET_PLATFORMS = [
  { name: 'Claude Code', target: '~/.claude/skills' },
  { name: 'Codex / Agents', target: '~/.agents/skills' },
  { name: 'Cursor', target: '~/.cursor/skills' },
  { name: 'Gemini CLI', target: '~/.gemini/skills' },
  { name: 'Qwen Code', target: '~/.qwen/skills' },
  { name: 'Windsurf', target: '~/.windsurf/skills' },
  { name: 'Trae', target: '~/.trae/skills' },
  { name: 'Trae CN', target: '~/.trae-cn/skills' },
  { name: 'Junie', target: '~/.junie/skills' },
  { name: 'Factory Droid', target: '~/.factory/skills' },
  { name: 'Augment', target: '~/.augment/skills' },
  { name: 'OpenCode', target: '~/.opencode/skills' },
  { name: 'KiloCode', target: '~/.kilocode/skills' },
  { name: 'Qoder', target: '~/.qoder/skills' },
  { name: 'OB1', target: '~/.ob1/skills' },
  { name: 'Amp', target: '~/.amp/skills' },
  { name: 'Kiro', target: '~/.kiro/skills' },
  { name: 'CodeBuddy', target: '~/.codebuddy/skills' }
];

const DEFAULT_SETTINGS = {
  skillRoot: 'Skills',
  platforms: [
    { name: 'Claude Code', target: '~/.claude/skills', enabled: true },
    { name: 'Codex / Agents', target: '~/.agents/skills', enabled: true }
  ],
  notifyOnStartup: true,
  autoScanIntervalMin: 5,
  autoInstall: true,
  autoImport: false
};

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function vaultBasePath(app) {
  const a = app.vault.adapter;
  return a.basePath || (typeof a.getBasePath === 'function' ? a.getBasePath() : '');
}

async function lstatSafe(p) {
  try { return await fsp.lstat(p); } catch { return null; }
}
async function exists(p) {
  return (await lstatSafe(p)) !== null;
}
async function isSymlink(p) {
  const st = await lstatSafe(p);
  return st ? st.isSymbolicLink() : false;
}
async function readlinkSafe(p) {
  try { return await fsp.readlink(p); } catch { return null; }
}

class SkillSyncPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new SkillSyncSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new SkillSyncView(leaf, this));

    this.addRibbonIcon('plug', 'Skill Sync', () => this.activateView());
    this.addCommand({
      id: 'open-skill-sync',
      name: '打开 Skill Sync 侧边栏',
      callback: () => this.activateView()
    });
    this.addCommand({
      id: 'refresh-skills',
      name: '刷新 Skill 列表',
      callback: () => this.refreshAllViews()
    });
    this.addCommand({
      id: 'install-all',
      name: '把所有 Skill 安装到所有 Coding 工具',
      callback: () => this.installAll()
    });
    this.addCommand({
      id: 'import-existing',
      name: '扫描并导入 Coding 工具里已有的 Skill',
      callback: () => new ImportModal(this.app, this).open()
    });
    this.addCommand({
      id: 'cleanup-dangling',
      name: '清理失效链接',
      callback: () => this.cleanupDangling()
    });
    this.addCommand({
      id: 'repair-mislinked',
      name: '修复指向错误的链接',
      callback: () => this.repairAllMislinked()
    });

    this.app.workspace.onLayoutReady(() => {
      setTimeout(() => this.checkAndNotifyOnStartup(), 1500);
      this.startAutoScan();
    });
  }

  onunload() {
    this.stopAutoScan();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  startAutoScan() {
    this.stopAutoScan();
    const min = Number(this.settings.autoScanIntervalMin) || 0;
    if (min <= 0) return;
    this._scanTimer = setInterval(() => this.autoScanTick(), min * 60 * 1000);
  }

  stopAutoScan() {
    if (this._scanTimer) {
      clearInterval(this._scanTimer);
      this._scanTimer = null;
    }
  }

  async autoScanTick() {
    let installedN = 0, importedN = 0;
    if (this.settings.autoInstall) {
      const skills = await this.listSkills();
      for (const s of skills) {
        for (const p of this.settings.platforms) {
          if (!p.enabled) continue;
          const st = await this.getStatus(s, p);
          if (st.state === 'missing') {
            if (await this.install(s, p)) installedN++;
          }
        }
      }
    }
    if (this.settings.autoImport) {
      const items = await this.listImportable();
      for (const it of items) {
        if (await this.importSkill(it)) importedN++;
      }
    }
    if (installedN > 0 || importedN > 0) {
      const parts = [];
      if (installedN > 0) parts.push(`安装 ${installedN}`);
      if (importedN > 0) parts.push(`导入 ${importedN}`);
      new obsidian.Notice(`Skill Sync 自动同步：${parts.join(' / ')}`, 6000);
      this.refreshAllViews();
    } else if (this.settings.notifyOnStartup) {
      const s = await this.getSyncSummary();
      if (s.hasIssue) {
        const parts = [];
        if (s.notInstalled > 0) parts.push(`${s.notInstalled} 未安装`);
        if (s.partiallySynced > 0) parts.push(`${s.partiallySynced} 部分同步`);
        if (s.importableCount > 0) parts.push(`${s.importableCount} 待导入`);
        if (parts.length > 0) {
          new obsidian.Notice(`Skill Sync 状态：${parts.join(' / ')}`, 5000);
        }
      }
    }
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = {
      skillRoot: data.skillRoot || DEFAULT_SETTINGS.skillRoot,
      platforms: Array.isArray(data.platforms) && data.platforms.length
        ? data.platforms
        : DEFAULT_SETTINGS.platforms.map(p => ({ ...p })),
      notifyOnStartup: data.notifyOnStartup !== false,
      autoScanIntervalMin: typeof data.autoScanIntervalMin === 'number' ? data.autoScanIntervalMin : DEFAULT_SETTINGS.autoScanIntervalMin,
      autoInstall: data.autoInstall !== false,
      autoImport: data.autoImport === true
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.startAutoScan();
    this.refreshAllViews();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  refreshAllViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(l => {
      if (l.view && typeof l.view.render === 'function') l.view.render();
    });
  }

  skillRootAbs() {
    return path.join(vaultBasePath(this.app), this.settings.skillRoot);
  }

  async listSkills() {
    const root = this.skillRootAbs();
    if (!(await exists(root))) return [];
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const skills = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const dir = path.join(root, e.name);
      const skillMd = path.join(dir, 'SKILL.md');
      let description = '';
      if (await exists(skillMd)) {
        try {
          const txt = await fsp.readFile(skillMd, 'utf8');
          const m = txt.match(/^---\n([\s\S]*?)\n---/);
          if (m) {
            const d = m[1].match(/^description:\s*(.+)$/m);
            if (d) description = d[1].trim();
          }
        } catch {}
      }
      skills.push({ name: e.name, abs: dir, description });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }

  async getStatus(skill, platform) {
    const target = path.join(expandHome(platform.target), skill.name);
    if (!(await exists(target))) return { state: 'missing', target };
    const link = await readlinkSafe(target);
    if (link == null) return { state: 'conflict', target };
    const linkAbs = path.isAbsolute(link) ? link : path.resolve(path.dirname(target), link);
    if (path.resolve(linkAbs) === path.resolve(skill.abs)) return { state: 'linked', target };
    return { state: 'mislinked', target, current: linkAbs };
  }

  async install(skill, platform) {
    const targetDir = expandHome(platform.target);
    try {
      await fsp.mkdir(targetDir, { recursive: true });
    } catch (e) {
      new obsidian.Notice(`无法创建 Coding 工具的 Skill 目录 ${targetDir}: ${e.message}`);
      return false;
    }
    const target = path.join(targetDir, skill.name);
    if (await exists(target)) {
      const link = await readlinkSafe(target);
      if (link == null) {
        new obsidian.Notice(`冲突：${target} 已存在且不是链接，未操作`);
        return false;
      }
      await fsp.unlink(target);
    }
    try {
      await fsp.symlink(skill.abs, target, 'dir');
    } catch (e) {
      new obsidian.Notice(`创建链接失败：${e.message}`);
      return false;
    }
    new obsidian.Notice(`✓ 已安装 ${skill.name} → ${platform.name}`);
    return true;
  }

  async uninstall(skill, platform) {
    const target = path.join(expandHome(platform.target), skill.name);
    if (!(await exists(target))) return false;
    if (!(await isSymlink(target))) {
      new obsidian.Notice(`安全保护：这是 Coding 工具自己的 Skill（不是从 Obsidian 链接过去的），插件不敢删`);
      return false;
    }
    try {
      await fsp.unlink(target);
    } catch (e) {
      new obsidian.Notice(`移除失败：${e.message}`);
      return false;
    }
    new obsidian.Notice(`✓ 已移除 ${skill.name} ← ${platform.name}`);
    return true;
  }

  async listImportable() {
    const seen = new Map();
    const vaultSkills = new Set((await this.listSkills()).map(s => s.name));
    for (const p of this.settings.platforms) {
      if (!p.enabled) continue;
      const dir = expandHome(p.target);
      if (!(await exists(dir))) continue;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        const st = await lstatSafe(full);
        if (!st || st.isSymbolicLink()) continue;
        if (vaultSkills.has(e.name)) continue;
        if (seen.has(e.name)) continue;
        seen.set(e.name, { name: e.name, abs: full, sourcePlatform: p.name });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async importSkill(item) {
    const root = this.skillRootAbs();
    await fsp.mkdir(root, { recursive: true });
    const dest = path.join(root, item.name);
    if (await exists(dest)) {
      new obsidian.Notice(`Obsidian 里已存在 ${item.name}，跳过`);
      return false;
    }
    try {
      await fsp.rename(item.abs, dest);
    } catch (e) {
      new obsidian.Notice(`移动失败 ${item.name}: ${e.message}`);
      return false;
    }
    const skill = { name: item.name, abs: dest, description: '' };
    for (const p of this.settings.platforms) {
      if (!p.enabled) continue;
      const target = path.join(expandHome(p.target), item.name);
      if (await exists(target)) {
        const link = await readlinkSafe(target);
        if (link != null) {
          try { await fsp.unlink(target); } catch {}
        } else {
          continue;
        }
      }
      try { await fsp.symlink(skill.abs, target, 'dir'); } catch {}
    }
    return true;
  }

  async installAll() {
    const skills = await this.listSkills();
    if (skills.length === 0) {
      new obsidian.Notice('未发现任何 skill');
      return;
    }
    let added = 0, skipped = 0, conflicts = 0;
    for (const s of skills) {
      for (const p of this.settings.platforms) {
        if (!p.enabled) continue;
        const st = await this.getStatus(s, p);
        if (st.state === 'linked') { skipped++; continue; }
        if (st.state === 'conflict') { conflicts++; continue; }
        if (await this.install(s, p)) added++;
      }
    }
    new obsidian.Notice(`批量完成：新增 ${added}，已存在 ${skipped}，冲突 ${conflicts}`);
    this.refreshAllViews();
  }

  async listDangling() {
    const dangling = [];
    for (const p of this.settings.platforms) {
      if (!p.enabled) continue;
      const dir = expandHome(p.target);
      if (!(await exists(dir))) continue;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const st = await lstatSafe(full);
        if (!st || !st.isSymbolicLink()) continue;
        try {
          await fsp.stat(full); // 跟随 symlink，失败说明 dangling
        } catch {
          const link = await readlinkSafe(full);
          dangling.push({ platform: p.name, name: e.name, target: full, points: link });
        }
      }
    }
    return dangling;
  }

  async cleanupDangling() {
    const list = await this.listDangling();
    let count = 0;
    for (const d of list) {
      try { await fsp.unlink(d.target); count++; } catch {}
    }
    new obsidian.Notice(`已清理 ${count} 个失效链接`);
    this.refreshAllViews();
    return count;
  }

  async repairAllMislinked() {
    const skills = await this.listSkills();
    let count = 0;
    for (const s of skills) {
      for (const p of this.settings.platforms) {
        if (!p.enabled) continue;
        const st = await this.getStatus(s, p);
        if (st.state === 'mislinked') {
          if (await this.install(s, p)) count++;
        }
      }
    }
    new obsidian.Notice(`已修复 ${count} 个指向错误的链接`);
    this.refreshAllViews();
    return count;
  }

  async getSyncSummary() {
    const skills = await this.listSkills();
    const importable = await this.listImportable();
    const dangling = await this.listDangling();
    const enabledPlatforms = this.settings.platforms.filter(p => p.enabled);
    let fullySynced = 0, partiallySynced = 0, notInstalled = 0;
    let mislinkedSkills = 0, conflictSkills = 0;
    for (const s of skills) {
      let linkedN = 0, mislinkedN = 0, conflictN = 0;
      for (const p of enabledPlatforms) {
        const st = await this.getStatus(s, p);
        if (st.state === 'linked') linkedN++;
        else if (st.state === 'mislinked') mislinkedN++;
        else if (st.state === 'conflict') conflictN++;
      }
      if (mislinkedN > 0) mislinkedSkills++;
      if (conflictN > 0) conflictSkills++;
      if (enabledPlatforms.length > 0 && linkedN === enabledPlatforms.length) fullySynced++;
      else if (linkedN > 0) partiallySynced++;
      else notInstalled++;
    }
    return {
      vaultSkillCount: skills.length,
      platformCount: enabledPlatforms.length,
      fullySynced, partiallySynced, notInstalled,
      mislinkedSkills, conflictSkills,
      importableCount: importable.length,
      danglingCount: dangling.length,
      hasIssue: notInstalled > 0 || partiallySynced > 0 || mislinkedSkills > 0 || conflictSkills > 0 || importable.length > 0 || dangling.length > 0
    };
  }

  async checkAndNotifyOnStartup() {
    if (!this.settings.notifyOnStartup) return;
    const s = await this.getSyncSummary();
    if (!s.hasIssue) return;
    const parts = [];
    if (s.notInstalled > 0) parts.push(`${s.notInstalled} 未安装`);
    if (s.partiallySynced > 0) parts.push(`${s.partiallySynced} 部分同步`);
    if (s.importableCount > 0) parts.push(`${s.importableCount} 待导入`);
    if (s.mislinkedSkills > 0) parts.push(`${s.mislinkedSkills} 指向错误`);
    if (s.danglingCount > 0) parts.push(`${s.danglingCount} 失效`);
    if (s.conflictSkills > 0) parts.push(`${s.conflictSkills} 冲突`);
    new obsidian.Notice(`Skill Sync: ${parts.join(' / ')}（点击查看）`, 8000);
  }
}

class SkillSyncView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.filterText = '';
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Skill Sync'; }
  getIcon() { return 'plug'; }
  async onOpen() { await this.render(); }
  async onClose() {}

  async renderStatusCard(c) {
    const card = c.createDiv({ cls: 'css-status-card' });
    const loading = card.createDiv({ cls: 'css-status-loading', text: '检查同步状态...' });
    const s = await this.plugin.getSyncSummary();
    loading.remove();

    const head = card.createDiv({ cls: 'css-status-head' });
    head.createEl('span', { cls: 'css-status-title', text: '同步状态' });
    head.createEl('span', {
      cls: 'css-status-overall ' + (s.hasIssue ? 'has-issue' : 'all-good'),
      text: s.hasIssue ? '需要操作' : '全部同步'
    });

    const grid = card.createDiv({ cls: 'css-status-grid' });
    const items = [
      {
        label: `Obsidian Skill (×${s.platformCount} 工具)`, value: s.vaultSkillCount, kind: 'info',
        tip: `Obsidian 里收藏的 Skill 总数。这些 Skill 会同步到 ${s.platformCount} 个 Coding 工具。`
      },
      {
        label: '已同步', value: s.fullySynced, kind: s.fullySynced > 0 ? 'good' : 'mute',
        tip: '所有启用的 Coding 工具都能用的 Skill 数。'
      },
      {
        label: '部分同步', value: s.partiallySynced, kind: s.partiallySynced > 0 ? 'warn' : 'mute', action: 'install',
        tip: '只在某些 Coding 工具能用、其他工具还没装的 Skill 数。点击一键补齐。'
      },
      {
        label: '未安装', value: s.notInstalled, kind: s.notInstalled > 0 ? 'warn' : 'mute', action: 'install',
        tip: '还没装到任何 Coding 工具的 Skill 数。常见于刚加了新 Skill 或换了新电脑。点击一键安装。'
      },
      {
        label: '待导入', value: s.importableCount, kind: s.importableCount > 0 ? 'warn' : 'mute', action: 'import',
        tip: 'Coding 工具那边自带的、还没收进 Obsidian 管理的 Skill 数。点击挑选哪些要纳入。'
      },
      {
        label: '指向错误', value: s.mislinkedSkills, kind: s.mislinkedSkills > 0 ? 'warn' : 'mute', action: 'repair',
        tip: '链接到了错误位置的 Skill 数（比如换电脑后 Obsidian 路径变了）。点击一键修正。'
      },
      {
        label: '失效 link', value: s.danglingCount, kind: s.danglingCount > 0 ? 'warn' : 'mute', action: 'cleanup',
        tip: '你已经删了源 Skill，但 Coding 工具那边还残留着空链接。点击清理。'
      },
      {
        label: '冲突', value: s.conflictSkills, kind: s.conflictSkills > 0 ? 'bad' : 'mute',
        tip: 'Coding 工具那边已经有同名 Skill（不是从 Obsidian 来的），插件不敢覆盖，需要你手动处理。'
      }
    ];
    items.forEach(it => {
      const cell = grid.createDiv({ cls: `css-status-cell css-${it.kind}` });
      cell.setAttr('aria-label', it.tip);
      cell.title = it.tip;
      cell.createDiv({ cls: 'css-status-num', text: String(it.value) });
      cell.createDiv({ cls: 'css-status-label', text: it.label });
      if (it.action && it.value > 0) {
        cell.addClass('css-clickable');
        cell.onclick = async () => {
          if (it.action === 'install') { await this.plugin.installAll(); }
          else if (it.action === 'import') { new ImportModal(this.app, this.plugin).open(); return; }
          else if (it.action === 'repair') { await this.plugin.repairAllMislinked(); }
          else if (it.action === 'cleanup') { await this.plugin.cleanupDangling(); }
          await this.render();
        };
      }
    });
  }

  async render() {
    const c = this.containerEl.children[1];
    c.empty();
    c.addClass('css-skill-sync');

    const header = c.createDiv({ cls: 'css-header' });
    header.createEl('h3', { text: 'Claude Skill Sync' });
    const btnRow = c.createDiv({ cls: 'css-btn-row' });
    const refreshBtn = btnRow.createEl('button', { text: '刷新' });
    refreshBtn.onclick = () => this.render();
    const installAllBtn = btnRow.createEl('button', { text: '全部安装', cls: 'mod-cta' });
    installAllBtn.onclick = async () => { await this.plugin.installAll(); await this.render(); };
    const importBtn = btnRow.createEl('button', { text: '导入现有' });
    importBtn.onclick = () => new ImportModal(this.app, this.plugin).open();

    const root = this.plugin.skillRootAbs();
    c.createDiv({ cls: 'css-meta', text: `Skill 文件夹：${root}` });

    await this.renderStatusCard(c);

    const skills = await this.plugin.listSkills();
    if (skills.length === 0) {
      const empty = c.createDiv({ cls: 'css-empty' });
      empty.createEl('div', { text: `还没有任何 Skill。` });
      empty.createEl('div', { text: `在 Obsidian 里创建：${this.plugin.settings.skillRoot}/<skill-name>/SKILL.md` });
      return;
    }

    const searchWrap = c.createDiv({ cls: 'css-search-wrap' });
    const searchInput = searchWrap.createEl('input', {
      type: 'search',
      cls: 'css-search-input',
      attr: { placeholder: '搜索 Skill 名或描述...' }
    });
    searchInput.value = this.filterText || '';
    const countEl = searchWrap.createEl('span', { cls: 'css-search-count' });

    const listEl = c.createDiv({ cls: 'css-skill-list' });

    for (const s of skills) {
      const card = listEl.createDiv({ cls: 'css-skill' });
      card.dataset.name = s.name.toLowerCase();
      card.dataset.desc = (s.description || '').toLowerCase();

      const nameRow = card.createDiv({ cls: 'css-name-row' });
      const toggle = nameRow.createSpan({ cls: 'css-toggle', text: s.description ? '▸' : ' ' });
      nameRow.createSpan({ cls: 'css-name', text: s.name });

      let descEl = null;
      if (s.description) {
        descEl = card.createEl('div', { cls: 'css-desc', text: s.description });
        descEl.style.display = 'none';
        const toggleDesc = (e) => {
          if (e) e.stopPropagation();
          const open = descEl.style.display === 'none';
          descEl.style.display = open ? '' : 'none';
          toggle.setText(open ? '▾' : '▸');
        };
        toggle.style.cursor = 'pointer';
        toggle.onclick = toggleDesc;
        nameRow.style.cursor = 'pointer';
        nameRow.onclick = toggleDesc;
      }

      for (const p of this.plugin.settings.platforms) {
        if (!p.enabled) continue;
        const row = card.createDiv({ cls: 'css-row' });
        row.createSpan({ cls: 'css-plat', text: p.name });

        const status = await this.plugin.getStatus(s, p);
        const labels = { linked: '已安装', missing: '未安装', conflict: '冲突', mislinked: '指向其他' };
        row.createSpan({ cls: `css-badge css-${status.state}`, text: labels[status.state] || status.state });

        if (status.state === 'linked') {
          const btn = row.createEl('button', { text: '移除' });
          btn.onclick = async () => { await this.plugin.uninstall(s, p); await this.render(); };
        } else if (status.state === 'missing') {
          const btn = row.createEl('button', { text: '安装', cls: 'mod-cta' });
          btn.onclick = async () => { await this.plugin.install(s, p); await this.render(); };
        } else if (status.state === 'mislinked') {
          row.createSpan({ cls: 'css-warn', text: `→ ${status.current}` });
          const btn = row.createEl('button', { text: '改指向' });
          btn.onclick = async () => { await this.plugin.install(s, p); await this.render(); };
        } else if (status.state === 'conflict') {
          row.createSpan({ cls: 'css-warn', text: 'Coding 工具里已有同名 Skill（不是链接），请手动处理' });
        }
      }
    }

    const filter = (q) => {
      this.filterText = q;
      const ql = (q || '').toLowerCase().trim();
      let visible = 0;
      listEl.querySelectorAll('.css-skill').forEach(card => {
        const match = !ql || card.dataset.name.includes(ql) || card.dataset.desc.includes(ql);
        card.style.display = match ? '' : 'none';
        if (match) visible++;
      });
      countEl.setText(ql ? `${visible} / ${skills.length}` : `${skills.length}`);
    };
    searchInput.oninput = (e) => filter(e.target.value);
    filter(this.filterText);
  }
}

class SkillSyncSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Claude Skill Sync' });

    new obsidian.Setting(containerEl)
      .setName('启动时提醒同步状态')
      .setDesc('打开 Obsidian 后扫描一次，如发现待安装/待导入/失效等问题弹通知')
      .addToggle(tg => tg
        .setValue(this.plugin.settings.notifyOnStartup)
        .onChange(async v => {
          this.plugin.settings.notifyOnStartup = v;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: '自动同步' });

    new obsidian.Setting(containerEl)
      .setName('定时扫描间隔（分钟）')
      .setDesc('后台每隔多少分钟自动检查一次。0 = 关闭定时扫描。建议 5-30。')
      .addText(t => t
        .setPlaceholder('5')
        .setValue(String(this.plugin.settings.autoScanIntervalMin))
        .onChange(async v => {
          const n = parseInt(v, 10);
          this.plugin.settings.autoScanIntervalMin = isNaN(n) ? 0 : Math.max(0, n);
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('自动安装新 Skill 到 Coding 工具')
      .setDesc('扫描时如发现 Obsidian 有新 Skill 还没装到 Coding 工具，自动建链接。安全（链接可逆）。建议开启。')
      .addToggle(tg => tg
        .setValue(this.plugin.settings.autoInstall)
        .onChange(async v => {
          this.plugin.settings.autoInstall = v;
          await this.plugin.saveSettings();
        }));

    const importSetting = new obsidian.Setting(containerEl)
      .setName('自动收 Coding 工具里的新 Skill 到 Obsidian')
      .setDesc('⚠️ 危险：扫描时如发现 Coding 工具里有新的实体 Skill 文件夹，自动移到 Obsidian。移动不可逆。仅当你确定 Coding 工具的 Skill 目录不会被其他工具临时使用时再开。')
      .addToggle(tg => tg
        .setValue(this.plugin.settings.autoImport)
        .onChange(async v => {
          this.plugin.settings.autoImport = v;
          await this.plugin.saveSettings();
        }));
    importSetting.descEl.style.color = 'var(--text-warning, #eab308)';

    new obsidian.Setting(containerEl)
      .setName('Obsidian 中的 Skill 文件夹')
      .setDesc('相对 Obsidian 根的路径。下面每个子文件夹视为一个 Skill。')
      .addText(t => t
        .setPlaceholder('Skills')
        .setValue(this.plugin.settings.skillRoot)
        .onChange(async v => {
          this.plugin.settings.skillRoot = (v || '').trim() || 'Skills';
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Coding 工具' });
    containerEl.createDiv({ cls: 'setting-item-description', text: '安装 = 让 Coding 工具能读到 Obsidian 里的 Skill。路径里 ~ 会自动展开成你的 home 目录。' });

    this.plugin.settings.platforms.forEach((p, idx) => {
      const wrap = containerEl.createDiv({ cls: 'css-platform-edit' });
      new obsidian.Setting(wrap)
        .setName(p.name || '(未命名)')
        .addText(t => t
          .setPlaceholder('名称')
          .setValue(p.name)
          .onChange(async v => {
            this.plugin.settings.platforms[idx].name = v;
            await this.plugin.saveSettings();
          }))
        .addText(t => t
          .setPlaceholder('~/.claude/skills')
          .setValue(p.target)
          .onChange(async v => {
            this.plugin.settings.platforms[idx].target = v.trim();
            await this.plugin.saveSettings();
          }))
        .addToggle(tg => tg
          .setValue(p.enabled)
          .setTooltip('启用')
          .onChange(async v => {
            this.plugin.settings.platforms[idx].enabled = v;
            await this.plugin.saveSettings();
          }))
        .addExtraButton(b => b
          .setIcon('trash')
          .setTooltip('删除该平台')
          .onClick(async () => {
            this.plugin.settings.platforms.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
          }));
    });

    new obsidian.Setting(containerEl)
      .addButton(b => b
        .setButtonText('+ 添加 Coding 工具')
        .setCta()
        .onClick(() => {
          new AddPlatformModal(this.app, this.plugin, () => this.display()).open();
        }));

    containerEl.createEl('h3', { text: '说明' });
    const ul = containerEl.createEl('ul');
    [
      '只在桌面端工作（移动端不支持链接）',
      '安装 = 在 Coding 工具的 Skill 目录里建一个链接，指回 Obsidian 里的源 Skill',
      '移除只断开链接，不会删除 Obsidian 里的原 Skill（安全保护）',
      '若 Coding 工具里已经有同名 Skill（不是从 Obsidian 链接过来的），状态会显示为「冲突」，需手动迁移或重命名',
      '跨电脑同步交给 Obsidian 自身（Obsidian Sync / iCloud / Git / Remotely Save）'
    ].forEach(t => ul.createEl('li', { text: t }));
  }
}

class ImportModal extends obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.selected = new Set();
    this.items = [];
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('css-skill-sync-modal');
    contentEl.createEl('h2', { text: '导入 Coding 工具里已有的 Skill 到 Obsidian' });
    contentEl.createEl('p', {
      cls: 'css-import-hint',
      text: '把 Coding 工具里已有的 Skill 收进 Obsidian 统一管理，之后所有 Coding 工具都能用同一份。已经链接好的或 Obsidian 里已有同名的会被自动过滤。'
    });

    const loading = contentEl.createDiv({ text: '扫描中...' });
    this.items = await this.plugin.listImportable();
    loading.remove();

    if (this.items.length === 0) {
      contentEl.createDiv({ cls: 'css-empty', text: '没有可导入的 Skill' });
      return;
    }

    const ctrl = contentEl.createDiv({ cls: 'css-import-ctrl' });
    const selAll = ctrl.createEl('button', { text: '全选' });
    const selNone = ctrl.createEl('button', { text: '清空' });
    const goBtn = ctrl.createEl('button', { text: '导入选中', cls: 'mod-cta' });
    ctrl.createSpan({ cls: 'css-import-count', text: `共 ${this.items.length} 个候选` });

    const listEl = contentEl.createDiv({ cls: 'css-import-list' });
    const checkboxes = [];
    this.items.forEach(item => {
      const row = listEl.createDiv({ cls: 'css-import-row' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.dataset.name = item.name;
      cb.onchange = () => {
        if (cb.checked) this.selected.add(item.name);
        else this.selected.delete(item.name);
      };
      checkboxes.push(cb);
      const label = row.createEl('label');
      label.createEl('strong', { text: item.name });
      label.createEl('span', { cls: 'css-source', text: ` ← ${item.sourcePlatform}` });
      label.createEl('div', { cls: 'css-source-path', text: item.abs });

      const delBtn = row.createEl('button', { cls: 'css-del-btn', text: '删除' });
      delBtn.title = '删除 Coding 工具里这份实体 Skill 文件夹（不可恢复）';
      let confirmTimer = null;
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (delBtn.dataset.confirm === '1') {
          if (confirmTimer) clearTimeout(confirmTimer);
          try {
            await fsp.rm(item.abs, { recursive: true, force: true });
            new obsidian.Notice(`已删除 ${item.name}`);
            this.selected.delete(item.name);
            row.remove();
            this.items = this.items.filter(x => x.name !== item.name);
            ctrl.querySelector('.css-import-count').setText(`共 ${this.items.length} 个候选`);
            if (this.items.length === 0) {
              listEl.remove();
              contentEl.createDiv({ cls: 'css-empty', text: '没有可导入的 Skill' });
            }
            this.plugin.refreshAllViews();
          } catch (err) {
            new obsidian.Notice(`删除失败：${err.message}`);
          }
          return;
        }
        delBtn.dataset.confirm = '1';
        delBtn.setText('再点确认');
        delBtn.addClass('mod-warning');
        confirmTimer = setTimeout(() => {
          delBtn.dataset.confirm = '0';
          delBtn.setText('删除');
          delBtn.removeClass('mod-warning');
        }, 3000);
      };
    });

    selAll.onclick = () => {
      checkboxes.forEach(cb => {
        cb.checked = true;
        this.selected.add(cb.dataset.name);
      });
    };
    selNone.onclick = () => {
      checkboxes.forEach(cb => { cb.checked = false; });
      this.selected.clear();
    };
    goBtn.onclick = async () => {
      if (this.selected.size === 0) {
        new obsidian.Notice('未选中任何 Skill');
        return;
      }
      goBtn.disabled = true;
      goBtn.setText('导入中...');
      let count = 0;
      for (const it of this.items) {
        if (!this.selected.has(it.name)) continue;
        if (await this.plugin.importSkill(it)) count++;
      }
      new obsidian.Notice(`已导入 ${count} 个 Skill 到 Obsidian`);
      this.close();
      this.plugin.refreshAllViews();
    };
  }

  onClose() { this.contentEl.empty(); }
}

class AddPlatformModal extends obsidian.Modal {
  constructor(app, plugin, onComplete) {
    super(app);
    this.plugin = plugin;
    this.onComplete = onComplete;
    this.selected = new Set();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('css-skill-sync-modal');
    contentEl.addClass('css-add-platform-modal');
    contentEl.createEl('h2', { text: '添加 Coding 工具' });

    const searchWrap = contentEl.createDiv({ cls: 'css-search-wrap' });
    const searchInput = searchWrap.createEl('input', {
      type: 'search',
      cls: 'css-search-input',
      attr: { placeholder: '搜索预设（如 cursor、gemini）...' }
    });
    const countEl = searchWrap.createEl('span', { cls: 'css-search-count' });

    const existingTargets = new Set(
      this.plugin.settings.platforms.map(p => (p.target || '').replace(/\/$/, ''))
    );
    const existingNames = new Set(this.plugin.settings.platforms.map(p => p.name));

    const listEl = contentEl.createDiv({ cls: 'css-preset-list' });
    PRESET_PLATFORMS.forEach(preset => {
      const exists = existingNames.has(preset.name) || existingTargets.has(preset.target);
      const row = listEl.createDiv({ cls: 'css-preset-row' });
      row.dataset.search = (preset.name + ' ' + preset.target).toLowerCase();
      const cb = row.createEl('input', { type: 'checkbox' });
      if (exists) {
        cb.disabled = true;
        cb.checked = true;
        row.addClass('css-preset-exists');
      }
      cb.onchange = () => {
        if (cb.checked) this.selected.add(preset.name);
        else this.selected.delete(preset.name);
      };
      const label = row.createEl('label');
      label.createSpan({ cls: 'css-preset-name', text: preset.name });
      label.createSpan({ cls: 'css-preset-path', text: preset.target });
      if (exists) label.createSpan({ cls: 'css-preset-tag', text: '已添加' });
    });

    const filter = (q) => {
      const ql = (q || '').toLowerCase().trim();
      let visible = 0;
      listEl.querySelectorAll('.css-preset-row').forEach(row => {
        const match = !ql || row.dataset.search.includes(ql);
        row.style.display = match ? '' : 'none';
        if (match) visible++;
      });
      countEl.setText(ql ? `${visible} / ${PRESET_PLATFORMS.length}` : `${PRESET_PLATFORMS.length}`);
    };
    searchInput.oninput = (e) => filter(e.target.value);
    filter('');

    const customToggle = contentEl.createEl('button', {
      cls: 'css-custom-toggle',
      text: '+ 自定义 Coding 工具'
    });
    const customWrap = contentEl.createDiv({ cls: 'css-custom-wrap' });
    customWrap.style.display = 'none';
    const customRow = customWrap.createDiv({ cls: 'css-custom-row' });
    const nameInput = customRow.createEl('input', { type: 'text' });
    nameInput.placeholder = '名称（如 My Tool）';
    const pathInput = customRow.createEl('input', { type: 'text' });
    pathInput.placeholder = '~/.your-tool/skills';
    customToggle.onclick = () => {
      const open = customWrap.style.display === 'none';
      customWrap.style.display = open ? '' : 'none';
      customToggle.setText(open ? '− 收起自定义' : '+ 自定义 Coding 工具');
      if (open) nameInput.focus();
    };

    const ctrl = contentEl.createDiv({ cls: 'css-import-ctrl' });
    const goBtn = ctrl.createEl('button', { text: '添加', cls: 'mod-cta' });
    goBtn.onclick = async () => {
      let added = 0;
      for (const preset of PRESET_PLATFORMS) {
        if (!this.selected.has(preset.name)) continue;
        if (existingNames.has(preset.name) || existingTargets.has(preset.target)) continue;
        this.plugin.settings.platforms.push({ name: preset.name, target: preset.target, enabled: true });
        added++;
      }
      const cn = (nameInput.value || '').trim();
      const cp = (pathInput.value || '').trim();
      if (cn && cp) {
        this.plugin.settings.platforms.push({ name: cn, target: cp, enabled: true });
        added++;
      } else if (cn || cp) {
        new obsidian.Notice('自定义 Coding 工具需要同时填名称和路径');
        return;
      }
      if (added === 0) {
        new obsidian.Notice('未选中任何预设也未填自定义');
        return;
      }
      await this.plugin.saveSettings();
      new obsidian.Notice(`已添加 ${added} 个 Coding 工具`);
      this.close();
      if (this.onComplete) this.onComplete();
    };
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = SkillSyncPlugin;
