1. 核心功能模块详细设计
1.1 环境检测与自愈
检测逻辑：插件 apply 钩子触发 gh --version。若失败，状态设为 installed: false。

自动弹窗 (Toast/Dialog)：未安装时，Client 端必须展示 阻塞式交互对话框，提供选项：

选项 A（自动安装）：检测 brew/winget/apt，执行 gh 安装命令（需用户二次确认）。

选项 B（手动指引）：根据 os.platform() 弹出带超链接的操作系统专属下载指南。

安装后回调：自动执行重新检测，刷新 UI 状态。

1.2 Git 仓库管理
在 gh 基础上，封装高频 Git 操作逻辑，提供 UI 交互面板：

功能按钮	底层实现（宿主 Node 侧）	异常处理
克隆仓库	读取输入框 repo (如 owner/repo)，执行 gh repo clone <repo> -- [--depth 1]	若目标目录存在，弹出覆盖确认框
仓库状态	执行 gh api repos/{owner}/{repo} 展示 Star、Fork、最后提交时间	404 捕获提示仓库不存在或权限不足
快速 Fork	当前登录用户执行 gh repo fork <repo> --clone	若已 Fork，自动切换至 fork 地址
创建仓库	执行 gh repo create <name> --public/--private --source=.	检查本地是否已初始化 Git
打开远程	调用系统默认浏览器打开当前 Git 仓库的 GitHub 页面	需解析本地 .git/config 获取 remote URL
1.3 认证与多账户管理（原需求 3 & 4 强化）
认证流程 UI：在 Settings 面板中放置 “登录 GitHub” 按钮，触发 gh auth login（交互式终端可能阻塞，建议改为 Device Flow 或 Token 粘贴模式）。

多账户切换：通过 gh auth status 解析所有登录用户，生成切换下拉菜单。切换本质是修改 GH_ACTIVE_USER 环境变量，执行 gh auth switch --user <target>。

凭证管理：提供 “刷新 Token” 和 “登出选定用户” 按钮。

2. Client 端 UI 布局专案（React/TSX）
请将设置面板设计为 三 Tab 结构，适配 DSH Harness 设置页样式：

Tab 1: 📦 状态与安装 (Status)
显眼徽章：✅ 已安装 v2.x.x / ❌ 未安装。

[重新检测] [一键安装/更新] 按钮。

显示当前 GH_HOST (企业版支持)。

Tab 2: 🔐 账户与 Git 配置 (Accounts & Git)
当前活跃账户：展示头像（调用 gh api user 的 avatar_url）+ 用户名。

账户列表：渲染 gh auth status 中的账户清单，每个卡片附带 [切换] [登出] 按钮。

Git 全局配置：输入框展示当前 git config user.name 和 user.email（通过 git config --global 读取），允许修改并写入。

Tab 3: 📁 仓库管理 (Repo Ops) —— 新增核心
克隆区域：输入框 org/repo + 目标路径选择器 + [Clone] 按钮。

当前仓库快捷操作：读取 DSH 当前挂载的 workdir 环境变量，自动识别是否在 Git 仓库内。若是，显示当前分支、未提交文件数，并提供 [Push] [Pull] [Create PR (gh pr create)] 快捷按钮。

3. Host 面技术实现约束
依赖最小化：禁止额外安装 simple-git 等 npm 包；所有 Git 操作必须依赖 gh 命令行（通过 execGh(['repo', ...]) 实现）或直接调用系统 git 命令（作为 gh 无法满足时的 fallback）。

跨平台路径处理：使用 node:path 处理 Windows/Linux 路径差异，克隆路径默认为 ~/dsh/workspace/。

日志记录：所有 gh 调用必须同时记录 stdout 和 stderr 到 DSH 插件日志 (ctx.logger)，便于调试。

命令超时：长时间命令（如 gh repo clone）必须设置 timeout: 300000 (5分钟) 并支持用户取消。

4. 开发交付清单 (AI 必须产出的文件)
请按以下列表生成文件，缺一不可：

text
dsh-ghcli/
├── package.json                  # 包含 dsh.bundle, dsh.client 入口
├── cordis.patch.yml              # 注册插件到 host 组合
├── tsconfig.json
├── src/
│   ├── index.ts                  # DSH Plugin 类 (apply, stop, 状态管理)
│   ├── host/
│   │   ├── gh-executor.ts        # execGh 封装
│   │   ├── gh-detector.ts        # 检测/安装逻辑
│   │   ├── gh-auth-manager.ts    # 登录/切换/登出 API
│   │   ├── git-manager.ts        # 新增：克隆/状态/Fork/PR 等业务逻辑
│   │   └── routes.ts             # HTTP 接口暴露给 Client (如 /api/gh/status)
│   └── client/
│       ├── index.tsx             # Client 入口，注册设置页面组件
│       ├── components/
│       │   ├── StatusTab.tsx
│       │   ├── AccountTab.tsx
│       │   └── RepoTab.tsx       # 新增：Git 操作 Tab
│       └── styles.css
└── README.md                     # 含手动安装 gh 的完整指南
5. 优先级与开发顺序 (P0-P3)
优先级	任务模块	关键产出
P0	项目骨架 + gh 检测回显	能在 Settings 看到安装状态
P0	Git 基础操作（克隆 + 状态）	满足“添加 Git 管理”核心诉求
P1	认证与账户切换 UI 联动	gh auth switch 生效
P2	一键安装引导流程	跨平台自动/手动安装
P3	快捷 PR / Fork 高级功能	提升体验的锦上添花
6. 给 AI 的特殊校验规则（自测标准）
在生成代码后，请 AI 自检以下断言是否成立：

□ 当未安装 gh 时，UI 不会报 Red Screen of Death，而是显示引导 Banner。
□ 执行 gh repo clone 时，若目标文件夹不为空，不会强制覆盖，必须弹出确认框。
□ 切换账户后，无需重启 DSH，全局 gh 上下文立即刷新。
□ Git 管理 Tab 中的 [Create PR] 仅当当前分支有 upstream 差异时才亮起。
