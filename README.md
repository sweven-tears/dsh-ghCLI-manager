# dsh-ghCLI — GitHub CLI 管理插件

面向 DeepSeek Harness（DSH）的 gh CLI 集成插件：环境检测与自愈、多账户认证管理、
Git 仓库高频操作，全部以 DSH **设置页**（侧边栏 → 设置 → GitHub CLI）呈现。

本插件是**标准 DSH 插件包**（npm 包形态）：host 半区（`src/host.js`，即 package.json
`main`）运行在宿主进程，注册 `/api/dsh-ghcli/*` 路由并执行 gh/git；client 半区
（`src/client.js`，即 `exports["./client"]`）以 module-loader 束加载进 Web GUI，
注册 `settings.section` 插槽。无需编译、无需改 DSH 源码；随 profile 常驻，
DSH 重启后自动加载。早期动态 Cordis 插件（`ghcli-1`，会话内 `cordis_define`）
形态已归档，代码不再兼容动态挂载。

---

## 0. 安装（常驻模式）

```powershell
dsh plugin --profile web add D:\Program\harness\plugins\dsh-ghCLI -w
```

- `-w` 必须：web profile 目录本身是 pnpm workspace root（`pnpm-workspace.yaml`
  的 `packages: [.]`），不加会报 `ERR_PNPM_ADDING_TO_ROOT`。
- 若报 `ERR_PNPM_UNEXPECTED_STORE`（store 布局版本不符），把全局 pnpm 升到 v10
  再重跑。
- 装完验证 `~/.dsh/profiles/web/package.json` 出现 `dsh-ghcli` 依赖与
  `dsh.profile.bundles` 条目、`node_modules/dsh-ghcli` 存在、`pnpm-lock.yaml`
  含该包；然后**重启 dsh web**（client 插件集合变更需重启生效），刷新页面后
  在 设置 → GitHub CLI 查看。
- 卸载：`dsh plugin --profile web remove dsh-ghcli`。本地 file: 依赖通常为
  符号链接，改 `src/` 后重启 dsh web 即生效。

### 0.1 从 GitHub Packages 安装（npm 包形态，`@sweven-tears/dsh-ghcli`）

本插件已发布到 GitHub Packages：<https://github.com/users/sweven-tears/packages/npm/dsh-ghcli>。
消费方需先配置作用域映射与认证（仓库已内置 `.npmrc` 作用域映射，无需手写 registry）：

```powershell
# 一次性认证：用户名 = GitHub 用户名，密码 = 带 read:packages 权限的 PAT
npm login --registry=https://npm.pkg.github.com/ --scope=@sweven-tears
# 安装到 web profile（需重启 dsh web 生效）
dsh plugin --profile web add @sweven-tears/dsh-ghcli -w
```

---

## 1. 功能总览

| Tab | 能力 | 底层命令 |
| --- | --- | --- |
| 📦 状态与安装 | gh 安装徽章（✅ 已安装 v2.x / ❌ 未安装）、重新检测、一键安装/更新、GH_HOST 展示、未安装引导 Banner（自动安装 / 手动指引）、**手动指定 gh 安装路径**、**一键加入 PATH**、**网络代理自愈**（检测系统代理并写入 git 配置 / 测试连接） | `gh --version`、`gh config get host`、winget/brew/apt、`reg add HKCU\Environment\Path` / `~/.bashrc`、`git config http.proxy` |
| 🔐 账户与 Git | 活跃账户头像+用户名、账户列表（切换/登出）、Token 粘贴登录（企业版 GH_HOST）、刷新 Token、Git 全局 user.name/user.email 读写 | `gh auth status`、`gh api user`、`gh auth login --with-token`、`gh auth switch --user`、`gh auth logout`、`gh auth refresh`、`git config --global` |
| 📁 仓库管理 | 克隆（目标非空弹确认框、浅克隆）、当前工作区仓库分支/未提交数/upstream 差异、Push/Pull/Create PR/打开远程页面、远程仓库 Star/Fork/最后推送、Fork、创建仓库 | `gh repo clone`、`gh api repos/{owner}/{repo}`、`gh repo fork`、`gh repo create`、`git push/pull/status/remote`、`gh pr create` |

## 2. 架构（模块清单）

插件包把目标功能映射到两份运行时源码（host 半区 `main` / client 半区
`exports["./client"]`），内部按同名模块组织（设计来源为开发初期的 readme.txt，
该文件已归档移除）：

| readme 文件 | 标准插件包中的对应物 |
| --- | --- |
| `src/host/gh-executor.ts` | `src/host.js` → `runArgv` / `readAll` / `resolveExe` |
| `src/host/gh-detector.ts` | `src/host.js` → `ensureEnv` / `detectGh` / `detectInstallers` / `installGh` |
| `src/host/gh-auth-manager.ts` | `src/host.js` → `authStatus` / `authLogin` / `authSwitch` / `authLogout` / `authRefresh` |
| `src/host/git-manager.ts` | `src/host.js` → `repoCurrent` / `repoClone` / `repoStatus` / `repoFork` / `repoCreate` / `repoOpenRemote` / `repoPush` / `repoPull` / `repoPrCreate` |
| `src/host/routes.ts` | `src/host.js` → 底部 `routes` 数组，经 `ctx.webServer.register` 注册的 `/api/dsh-ghcli/*` JSON 路由 |
| `src/client/index.tsx` + components | `src/client.js` → `GhSettings` / `StatusTab` / `AccountTab` / `RepoTab`，注册进 `settings.section` 插槽 |
| `src/client/styles.css` | `src/client.js` → `insertStyles(...)`（`data-plugin-css` 样式标签，使用 `--dsw-alias-*` 主题变量，自适应暗色） |

## 3. 关键实现约束（落地情况）

- **依赖最小化**：不安装任何 npm 包（无 simple-git）。Git 操作优先 `gh` CLI，
  本地仓库操作（状态/分支/upstream 差异/Push/Pull）直接调用系统 `git` 作为 fallback。
- **执行通道**：Host 侧使用 `ctx.subprocess.spawn`（显式 argv，无 shell 注入面），
  `resolveExecutable` 做 PATH 解析；所有 gh/git 调用统一走 `runArgv`。
- **跨平台路径**：`ensureEnv()` 探测平台（`cmd` 存在 → windows，否则 posix）与主目录，
  `joinPath()` 按平台选择分隔符；克隆默认目录 `~/dsh/workspace/`。
- **日志**：每个 gh/git 调用都通过 `console.log` 记录 argv、退出码、stdout/stderr
  字节数与内容摘要到 DSH 插件日志。
- **超时与取消**：`runArgv` 默认 30s；`gh repo clone` / `install` / `create` /
  `fork` 等长命令 300s（5 分钟），通过 `ctx.timer` 超时后 `handle.terminate()` 终止进程树；
  客户端长操作显示「取消」按钮，走 `gh.op.cancel` RPC。
- **环境探测**：DSH 动态沙箱无 `process`/`os`/`require`，因此平台与主目录由
  一次子进程探测（`cmd /c echo %USERPROFILE%` 或 `sh -c 'echo $HOME'`）获得并缓存。

## 4. 自检清单（readme 第 6 节）

- [x] **未安装 gh 时不崩**：`gh.status` 全链路 try/catch；`installed:false` 时
  Status/Accounts/Repo 三 Tab 均渲染引导 Banner 而非报错（本机即 gh 未安装环境，
  已实测检测路径）。
- [x] **克隆非空目录必须确认**：`repoClone` 先 `dirStatus(dest)`，非空且未确认时
  返回 `{ ok:false, needsConfirm:true }`，客户端弹出确认框；确认后**重命名备份**
  原目录再克隆，绝不强制覆盖/删除。
- [x] **切换账户立即生效**：`gh auth switch --user` 后每次调用都是全新 gh 进程，
  读取 gh 自身配置中的 active 账户，无需重启 DSH。
- [x] **Create PR 仅当有 upstream 差异亮起**：`repoCurrent` 计算
  `canCreatePr = hasUpstream && ahead > 0`（`git rev-list --left-right --count @{u}...HEAD`），
  客户端据此禁用/启用按钮并给 title 提示。

## 5. Client ↔ Host RPC 一览（/api/dsh-ghcli/* JSON 路由）

client 半区用同源 `fetch` POST 到 `/api/dsh-ghcli/<方法名>`（`jsonRoute` 生成，
带 loopback + 同源防护）；方法名与响应契约沿用早期动态版的 `harness.handle`：

`gh.status` · `gh.install` · `gh.setPath`（手动指定 gh 路径） · `gh.addPath`（加入 PATH） ·
`gh.net.status` · `gh.net.set` · `gh.net.auto`（自动使用系统代理） · `gh.net.clear` · `gh.net.test` ·
`gh.auth.login` · `gh.auth.switch` · `gh.auth.logout` · `gh.auth.refresh` ·
`gh.git.save` · `gh.repo.current` · `gh.repo.clone` · `gh.repo.status` ·
`gh.repo.fork` · `gh.repo.create` · `gh.repo.open` · `gh.repo.push` ·
`gh.repo.pull` · `gh.repo.pr` · `gh.op.cancel`

## 6. 网络代理自愈（踩坑内建）

**背景**：git（libcurl）不读取 Windows 系统代理（WinINET），在需要代理才能出网的
环境中 `git push/clone` 会报「直连超时 / Connection was aborted」，而浏览器、curl
等走系统代理的应用正常——表现为「git 连不上 GitHub，其他都正常」。

**插件能力**（📦 状态与安装 → 网络与代理）：
- 读取当前 git 代理配置（`git config http.proxy` / `https.proxy`）
- 读取 Windows 系统代理（注册表 `HKCU\...\Internet Settings` 的 ProxyEnable / ProxyServer）
- 「自动使用系统代理」：把检测到的系统代理一键写入 git 配置（可选当前仓库或全局）
- 「测试连接」：`git ls-remote` 实测 GitHub 连通性，失败时给出「建议配置代理」提示
- 「清除代理」：恢复直连

## 6. 手动安装 gh（完整指南）

> 未安装 gh 时，设置页「📦 状态与安装」会显示引导 Banner；下面三种方式任选其一。

### Windows

**方式 A — winget（推荐）**

```powershell
winget install --id GitHub.cli -e --source winget
# 或在设置页点「一键安装」
```

**方式 B — 官方安装器**

下载 <https://cli.github.com/> 的 `gh_x.x.x_windows_amd64.zip`，解压后把
`bin/gh.exe` 所在目录加入系统 PATH，重开终端验证：

```powershell
gh --version
```

### macOS

```bash
brew install gh
# 或
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
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
2. 「🔐 账户与 Git」→ 粘贴 Personal Access Token（需 `repo`、`read:org` 权限）登录；
   或终端执行 `gh auth login` 走浏览器 Device Flow。
3. 可选：`gh auth setup-git` 让 git push/pull 复用 gh 凭证。

## 7. 使用注意

- 认证 Token 只经本机 `gh auth login --with-token` 写入 gh 的凭证存储，不经过网络上传。
- `gh repo create --source <目录> --push` 会把当前目录内容推送到新建仓库，请确认目录内容。
- 克隆/安装等长命令可随时点「取消」终止（进程树级终止）。
