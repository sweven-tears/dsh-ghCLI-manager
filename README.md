# dsh-ghCLI — GitHub CLI 管理插件

## 1. 插件介绍

dsh-ghCLI 是面向 DeepSeek Harness（DSH）的 **gh CLI 集成插件**，提供三大能力：

- **gh 安装检测与自愈**：检测 gh 是否安装、一键安装/更新、手动指定 gh 路径、一键加入 PATH，并内置 **Windows 网络代理自愈**（git 不读系统代理导致连不上 GitHub 的踩坑解决方案）。
- **多账户认证管理**：Token 登录（支持企业版 GH_HOST）、账户切换/登出/刷新、Git 全局 user.name / user.email 读写。
- **Git 仓库高频操作**：克隆、当前仓库 Push / Pull / Create PR / 打开远程页面 / Fork / 创建仓库等。

所有功能集中在 DSH **设置页**（侧边栏 → 设置 → GitHub CLI），底层直接调用本机 `gh` 与 `git` 命令，无需额外 npm 依赖。

插件为标准 DSH 插件包（npm 包形态）：host 半区（`src/host.js`，即 package.json `main`）运行在宿主进程，注册 `/api/dsh-ghcli/*` 路由并执行 gh/git；client 半区（`src/client.js`，即 `exports["./client"]`）以 module-loader 束加载进 Web GUI，注册 `settings.section` 插槽。随 profile 常驻，DSH 重启后自动加载。

## 2. 插件使用：dsh 安装命令

插件安装通过 `dsh plugin` 命令完成（该命令会把参数透传给 profile 目录内的 pnpm）。以下两种方式任选其一。

### 方式 A：git 安装（源码）

```powershell
# 1. 克隆仓库
git clone https://github.com/sweven-tears/dsh-ghCLI-manager.git
# 2. 安装到 web profile（<仓库路径> 替换为克隆后的本地绝对路径）
dsh plugin --profile web add D:\path\to\dsh-ghCLI-manager -w
```

### 方式 B：npm 安装（GitHub Packages 发布包）

插件已发布到 GitHub Packages：<https://github.com/users/sweven-tears/packages/npm/dsh-ghcli>。仓库已内置 `.npmrc` 作用域映射，无需手写 registry：

```powershell
# 一次性认证：用户名 = GitHub 用户名，密码 = 带 read:packages 权限的 PAT
npm login --registry=https://npm.pkg.github.com/ --scope=@sweven-tears
# 安装到 web profile
dsh plugin --profile web add @sweven-tears/dsh-ghcli -w
```

### 安装要点

- **`-w` 必须**：web profile 目录本身是 pnpm workspace root（`pnpm-workspace.yaml` 的 `packages: [.]`），不加会报 `ERR_PNPM_ADDING_TO_ROOT`。
- 若报 `ERR_PNPM_UNEXPECTED_STORE`（store 布局版本不符），把全局 pnpm 升到 v10 再重跑。
- 若提示 "Ignored build scripts"，在 profile 目录执行 `pnpm approve-builds` 放行。
- 装完验证 `~/.dsh/profiles/web/package.json` 出现 `dsh-ghcli` 依赖与 `dsh.profile.bundles` 条目、`node_modules/dsh-ghcli` 存在；然后 **重启 dsh web**（client 插件集合变更需重启生效），刷新页面后在 设置 → GitHub CLI 查看。
- 卸载：`dsh plugin --profile web remove dsh-ghcli`。本地 file: 依赖通常为符号链接，改 `src/` 后重启 dsh web 即生效。

## 3. 功能介绍

| Tab | 能力 | 底层命令 |
| --- | --- | --- |
| 📦 状态与安装 | gh 安装徽章（✅ 已安装 v2.x / ❌ 未安装）、重新检测、一键安装/更新、GH_HOST 展示、未安装引导 Banner（自动安装 / 手动指引）、**手动指定 gh 安装路径**、**一键加入 PATH**、**网络代理自愈**（检测系统代理并写入 git 配置 / 测试连接） | `gh --version`、`gh config get host`、winget/brew/apt、`reg add HKCU\Environment\Path` / `~/.bashrc`、`git config http.proxy` |
| 🔐 账户与 Git | 活跃账户头像+用户名、账户列表（切换/登出）、Token 粘贴登录（企业版 GH_HOST）、刷新 Token、Git 全局 user.name/user.email 读写 | `gh auth status`、`gh api user`、`gh auth login --with-token`、`gh auth switch --user`、`gh auth logout`、`gh auth refresh`、`git config --global` |
| 📁 仓库管理 | 克隆（目标非空弹确认框、浅克隆）、当前工作区仓库分支/未提交数/upstream 差异、Push/Pull/Create PR/打开远程页面、远程仓库 Star/Fork/最后推送、Fork、创建仓库 | `gh repo clone`、`gh api repos/{owner}/{repo}`、`gh repo fork`、`gh repo create`、`git push/pull/status/remote`、`gh pr create` |

### 网络代理自愈（踩坑内建）

**背景**：git（libcurl）不读取 Windows 系统代理（WinINET），在需要代理才能出网的环境中 `git push/clone` 会报「直连超时 / Connection was aborted」，而浏览器、curl 等走系统代理的应用正常——表现为「git 连不上 GitHub，其他都正常」。

**插件能力**（📦 状态与安装 → 网络与代理）：

- 读取当前 git 代理配置（`git config http.proxy` / `https.proxy`）
- 读取 Windows 系统代理（注册表 `HKCU\...\Internet Settings` 的 ProxyEnable / ProxyServer）
- 「自动使用系统代理」：把检测到的系统代理一键写入 git 配置（可选当前仓库或全局）
- 「测试连接」：`git ls-remote` 实测 GitHub 连通性，失败时给出「建议配置代理」提示
- 「清除代理」：恢复直连

### 实现要点

- **依赖最小化**：不安装任何 npm 包（无 simple-git）。Git 操作优先 `gh` CLI，本地仓库操作（状态/分支/upstream 差异/Push/Pull）直接调用系统 `git` 作为 fallback。
- **执行通道**：Host 侧使用 `ctx.subprocess.spawn`（显式 argv，无 shell 注入面）；所有 gh/git 调用统一走 `runArgv`，每个调用都记录日志。
- **超时与取消**：`runArgv` 默认 30s；`gh repo clone` / `install` / `create` / `fork` 等长命令 300s（5 分钟），超时后终止进程树；客户端长操作显示「取消」按钮。
- **安全**：克隆非空目录必须先确认，确认后**重命名备份**原目录再克隆，绝不强制覆盖/删除；切换账户立即生效（每次调用全新 gh 进程），无需重启 DSH。

## 4. gh 安装指南

> 未安装 gh 时，设置页「📦 状态与安装」会显示引导 Banner；下面三种方式任选其一，也可直接在设置页点「一键安装」。

### Windows

**方式 A — winget（推荐）**

```powershell
winget install --id GitHub.cli -e --source winget
```

**方式 B — 官方安装器**

下载 <https://cli.github.com/> 的 `gh_x.x.x_windows_amd64.zip`，解压后把 `bin/gh.exe` 所在目录加入系统 PATH，重开终端验证：

```powershell
gh --version
```

### macOS

```bash
brew install gh
```

### Linux（Debian/Ubuntu）

```bash
sudo mkdir -p -m 755 /etc/apt/keyrings
wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh
```

### 安装后

1. 回到设置页点「重新检测」，徽章应变为 ✅ 已安装 v2.x.x。
2. 「🔐 账户与 Git」→ 粘贴 Personal Access Token（需 `repo`、`read:org` 权限）登录；或终端执行 `gh auth login` 走浏览器 Device Flow。
3. 可选：`gh auth setup-git` 让 git push/pull 复用 gh 凭证。

## 5. 使用注意

- 认证 Token 只经本机 `gh auth login --with-token` 写入 gh 的凭证存储，不经过网络上传。
- 克隆/安装等长命令可随时点「取消」终止（进程树级终止）。
- `gh repo create --source <目录> --push` 会把当前目录内容推送到新建仓库，请先确认目录内容。
- Create PR 仅当仓库存在 upstream 差异且本地领先时可用（按钮会相应置灰并提示）。
- 未安装 gh 时插件不会报错：Status / Accounts / Repo 三个 Tab 均渲染引导 Banner 而非异常。
