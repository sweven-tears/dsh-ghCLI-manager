// dsh-ghCLI · Client 半区（动态 Cordis Plugin 的 code.client 函数体）
// 在 DSH 设置页注册「GitHub CLI」分区，内含三 Tab：
//   📦 状态与安装 (Status)   —— 安装徽章 / 重新检测 / 一键安装 / 未安装引导 Banner
//   🔐 账户与 Git (Accounts) —— 活跃账户 + 账户列表切换/登出 + Token 登录 + Git 全局配置
//   📁 仓库管理 (Repo Ops)   —— 克隆（非空确认）/ 当前仓库 Push/Pull/PR/打开远程 / 远程状态 / Fork / 创建
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const workspaces = ctx.get('workspaces')

    styles.insert(`
.ghcli-root{display:flex;flex-direction:column;gap:12px;padding:4px 2px 16px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.ghcli-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l1,#333);padding-bottom:8px;flex-wrap:wrap}
.ghcli-tab{padding:6px 12px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-size:13px}
.ghcli-tab:hover{background:var(--dsw-alias-bg-layer-1,#1e1e1e)}
.ghcli-tab.active{background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-border-l2,#444)}
.ghcli-card{background:var(--dsw-alias-bg-layer-1,#1b1b1b);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px}
.ghcli-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ghcli-spread{justify-content:space-between}
.ghcli-input{background:var(--dsw-alias-bg-base,#141414);border:1px solid var(--dsw-alias-border-l1,#333);color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:6px;padding:6px 8px;font-size:13px;min-width:0;flex:1}
.ghcli-btn{background:var(--dsw-alias-bg-layer-2,#262626);border:1px solid var(--dsw-alias-border-l1,#333);color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.ghcli-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2,#555)}
.ghcli-btn:disabled{opacity:.5;cursor:not-allowed}
.ghcli-btn.primary{background:var(--dsw-alias-brand-primary,#4f8cff);border-color:transparent;color:#fff}
.ghcli-btn.danger{background:transparent;border-color:var(--dsw-alias-state-error-primary,#e5534b);color:var(--dsw-alias-state-error-primary,#e5534b)}
.ghcli-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600}
.ghcli-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2da44e) 18%,transparent);color:var(--dsw-alias-state-success-primary,#2da44e)}
.ghcli-badge.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5534b) 18%,transparent);color:var(--dsw-alias-state-error-primary,#e5534b)}
.ghcli-banner{border:1px solid var(--dsw-alias-state-warn-primary,#bf8700);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#bf8700) 12%,transparent);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px}
.ghcli-msg.err{color:var(--dsw-alias-state-error-primary,#e5534b);font-size:12px}
.ghcli-msg.ok{color:var(--dsw-alias-state-success-primary,#2da44e);font-size:12px}
.ghcli-hint{color:var(--dsw-alias-label-secondary,#999);font-size:12px}
.ghcli-avatar{width:36px;height:36px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,#555);object-fit:cover}
.ghcli-acc{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--dsw-alias-border-l1,#333);border-radius:8px}
.ghcli-field{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.ghcli-label{font-size:12px;color:var(--dsw-alias-label-secondary,#999)}
.ghcli-spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,#555);border-top-color:var(--dsw-alias-brand-primary,#4f8cff);border-radius:50%;animation:ghcli-spin .8s linear infinite;vertical-align:-2px}
@keyframes ghcli-spin{to{transform:rotate(360deg)}}
`)

    const h = React.createElement
    const BUSY_LABELS = {
      'gh.status': '检测中…',
      'gh.install': '正在安装/更新 gh…',
      'gh.auth.login': '登录中…',
      'gh.auth.switch': '切换账户中…',
      'gh.auth.logout': '登出中…',
      'gh.auth.refresh': '刷新 Token 中…',
      'gh.git.save': '保存 Git 配置…',
      'gh.repo.clone': '克隆中…',
      'gh.repo.status': '查询仓库状态…',
      'gh.repo.fork': 'Fork 中…',
      'gh.repo.create': '创建仓库中…',
      'gh.repo.push': 'Push 中…',
      'gh.repo.pull': 'Pull 中…',
      'gh.repo.pr': '创建 PR 中…',
      'gh.net.set': '设置代理中…',
      'gh.net.auto': '应用系统代理中…',
      'gh.net.clear': '清除代理中…',
      'gh.net.test': '测试连接中…',
    }

    function GhSettings(props) {
      const [tab, setTab] = React.useState('status')
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [opId, setOpId] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)

      async function call(method, args, extra = {}) {
        const id = method + '-' + Date.now()
        if (extra.long) setOpId(id)
        setBusy(method)
        setError(null)
        setNotice(null)
        try {
          const payload = Object.assign({}, args || {})
          if (extra.long) payload.opId = id
          const res = await host.call(method, payload)
          if (res && res.ok === false) {
            if (res.needsConfirm) return res
            setError(String(res.error || res.message || '操作失败'))
            return res
          }
          if (res && res.message) setNotice(String(res.message))
          return res
        } catch (e) {
          setError(String((e && e.message) || e))
          return null
        } finally {
          setBusy(null)
          setOpId(null)
        }
      }

      async function refresh() {
        const res = await call('gh.status')
        if (res && res.ok) setStatus(res)
      }

      React.useEffect(() => {
        let alive = true
        host.call('gh.status', {}).then((res) => {
          if (!alive) return
          if (res && res.ok) setStatus(res)
          else setError(String((res && res.error) || '状态检测失败'))
        }).catch((e) => {
          if (alive) setError(String((e && e.message) || e))
        })
        return () => { alive = false }
      }, [])

      const wsState = props.useWorkspaces ? props.useWorkspaces((s) => s) : null
      const wsItems = (wsState && wsState.items) || []
      const currentWs = wsItems.find((w) => w.workspaceId === wsState.recentWorkspaceId) || wsItems[0] || null
      const workdir = currentWs ? currentWs.path : null

      async function pickDir() {
        try {
          if (!workspaces) return null
          return await workspaces.pickDirectory()
        } catch (e) {
          return null
        }
      }

      const busyLabel = busy ? (BUSY_LABELS[busy] || busy) : null
      const tabProps = { status, busy, workdir, call, refresh, pickDir }

      return h('div', { className: 'ghcli-root' },
        h('div', { className: 'ghcli-tabs' },
          h('button', { className: 'ghcli-tab' + (tab === 'status' ? ' active' : ''), onClick: () => setTab('status') }, '📦 状态与安装'),
          h('button', { className: 'ghcli-tab' + (tab === 'accounts' ? ' active' : ''), onClick: () => setTab('accounts') }, '🔐 账户与 Git'),
          h('button', { className: 'ghcli-tab' + (tab === 'repo' ? ' active' : ''), onClick: () => setTab('repo') }, '📁 仓库管理'),
        ),
        busyLabel ? h('div', { className: 'ghcli-row' },
          h('span', { className: 'ghcli-spinner' }),
          h('span', { className: 'ghcli-hint' }, busyLabel),
          opId ? h('button', { className: 'ghcli-btn danger', onClick: () => { host.call('gh.op.cancel', { opId }).catch(() => {}) } }, '取消') : null,
        ) : null,
        error ? h('div', { className: 'ghcli-msg err' }, '⚠ ' + error) : null,
        notice ? h('div', { className: 'ghcli-msg ok' }, '✓ ' + notice) : null,
        tab === 'status' ? h(StatusTab, tabProps) : null,
        tab === 'accounts' ? h(AccountTab, tabProps) : null,
        tab === 'repo' ? h(RepoTab, tabProps) : null,
      )
    }

    function StatusTab(p) {
      const st = p.status
      const installed = !!(st && st.installed)
      const installers = (st && st.installers) || []
      const guideLinks = {
        windows: { url: 'https://cli.github.com/', label: 'Windows / winget 安装指南' },
        mac: { url: 'https://cli.github.com/', label: 'macOS / Homebrew 安装指南' },
        posix: { url: 'https://cli.github.com/manual/installation', label: 'Linux 安装指南' },
      }
      const guide = st ? (guideLinks[st.platform] || guideLinks.posix) : guideLinks.posix
      const platformName = st && st.platform === 'windows' ? 'Windows' : (st && st.platform === 'mac' ? 'macOS' : 'Linux')

      const [manualPath, setManualPath] = React.useState('')
      React.useEffect(() => {
        if (st) setManualPath(st.manualPath || '')
      }, [st])
      const isWin = !!(st && st.platform === 'windows')
      const addPathLabel = isWin ? '添加到用户 PATH' : '写入 shell 启动文件'

      const [net, setNet] = React.useState(null)
      const [proxyInput, setProxyInput] = React.useState('')
      const [proxyScope, setProxyScope] = React.useState('repo')
      React.useEffect(() => {
        let alive = true
        host.call('gh.net.status', {}).then((res) => { if (alive && res && res.ok) setNet(res) }).catch(() => {})
        return () => { alive = false }
      }, [])
      async function refreshNet() {
        const r = await host.call('gh.net.status', {})
        if (r && r.ok) setNet(r)
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        !st ? h('div', { className: 'ghcli-card' }, h('div', { className: 'ghcli-hint' }, '正在检测 gh 环境…')) : null,

        st ? h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-row ghcli-spread' },
            installed
              ? h('span', { className: 'ghcli-badge ok' }, '✅ 已安装' + (st.version ? ' v' + st.version : ''))
              : h('span', { className: 'ghcli-badge bad' }, '❌ 未安装'),
            h('div', { className: 'ghcli-row' },
              h('button', { className: 'ghcli-btn', disabled: !!p.busy, onClick: () => p.refresh() }, '重新检测'),
              h('button', { className: 'ghcli-btn primary', disabled: !!p.busy, onClick: async () => { const r = await p.call('gh.install', {}, { long: true }); if (r && r.ok) p.refresh() } }, installed ? '一键更新' : '一键安装'),
            ),
          ),
          h('div', { className: 'ghcli-hint' }, 'GH_HOST：' + (st.ghHost || 'github.com（默认）')),
          h('div', { className: 'ghcli-hint' }, '平台：' + platformName + ' ｜ 主目录：' + (st.home || '未知')),
        ) : null,

        st && !installed ? h('div', { className: 'ghcli-banner' },
          h('div', { style: { fontWeight: 600 } }, 'gh CLI 尚未安装或不在 PATH，GitHub 操作暂不可用'),
          h('div', { className: 'ghcli-hint' }, installers.length
            ? '检测到包管理器：' + installers.join(' / ') + '，可一键安装；或在下方向 gh 指定安装目录 / 手动安装。'
            : '可在下方手动指定已安装的 gh 路径，或按手动指引安装。'),
          h('div', { className: 'ghcli-row' },
            installers.length ? h('button', { className: 'ghcli-btn primary', disabled: !!p.busy, onClick: async () => { const r = await p.call('gh.install', {}, { long: true }); if (r && r.ok) p.refresh() } }, '⚡ 自动安装 gh') : null,
            h('a', { className: 'ghcli-btn', href: guide.url, target: '_blank', rel: 'noreferrer' }, '📖 ' + guide.label),
          ),
          h('div', { className: 'ghcli-hint' }, '安装完成后点击「重新检测」即可。'),
        ) : null,

        st ? h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, 'gh 安装路径'),
          h('div', { className: 'ghcli-hint' }, '当前使用：' + (st.path ? st.path : '未找到（gh 不在 PATH，可手动指定下方路径）')),
          h('div', { className: 'ghcli-hint' }, st.manualPath ? '手动指定：' + st.manualPath : '手动指定：未设置'),
          h('div', { className: 'ghcli-row' },
            h('input', { className: 'ghcli-input', placeholder: 'gh.exe 完整路径或所在目录，如 C:\\Program Files\\gh-cli\\bin', value: manualPath, onChange: (e) => setManualPath(e.target.value), disabled: !!p.busy }),
            h('button', { className: 'ghcli-btn', disabled: !!p.busy, onClick: async () => { const d = await p.pickDir(); if (d) setManualPath(d) } }, '浏览…'),
          ),
          h('div', { className: 'ghcli-row' },
            h('button', { className: 'ghcli-btn primary', disabled: !!p.busy || !manualPath.trim(), onClick: async () => { const r = await p.call('gh.setPath', { path: manualPath.trim() }); if (r && r.ok) p.refresh() } }, '设置路径'),
            h('button', { className: 'ghcli-btn', disabled: !!p.busy || !(st && st.manualPath), onClick: async () => { const r = await p.call('gh.setPath', { path: '' }); if (r && r.ok) { setManualPath(''); p.refresh() } } }, '清除'),
            h('button', { className: 'ghcli-btn', disabled: !!p.busy || !manualPath.trim(), onClick: async () => { const r = await p.call('gh.addPath', { dir: manualPath.trim() }); if (r && r.ok) p.refresh() } }, addPathLabel),
          ),
          h('div', { className: 'ghcli-hint' }, 'gh 已安装但检测不到时（不在 PATH）：在此指定其安装目录即可立即使用；「' + addPathLabel + '」可把它加入环境变量 PATH（可选，重启 DSH / 新终端后全局生效）。'),
        ) : null,

        st ? h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, '网络与代理（git push 直连超时自愈）'),
          h('div', { className: 'ghcli-hint' }, '当前 git 代理：' + ((net && (net.gitHttpProxy || net.gitHttpsProxy)) ? (net.gitHttpProxy || net.gitHttpsProxy) : '未配置（直连，网络受限时 push/clone 会超时）')),
          h('div', { className: 'ghcli-hint' }, '系统代理（WinINET）：' + ((net && net.systemProxy) ? net.systemProxy : '未检测到' + (isWin ? '' : '（仅 Windows 自动检测）'))),
          h('div', { className: 'ghcli-row' },
            h('input', { className: 'ghcli-input', placeholder: '如 http://127.0.0.1:7897', value: proxyInput, onChange: (e) => setProxyInput(e.target.value), disabled: !!p.busy }),
            h('select', { className: 'ghcli-input', style: { flex: '0 0 auto', width: 130 }, value: proxyScope, onChange: (e) => setProxyScope(e.target.value) },
              h('option', { value: 'repo' }, '当前仓库'),
              h('option', { value: 'global' }, '全局'),
            ),
          ),
          h('div', { className: 'ghcli-row' },
            h('button', { className: 'ghcli-btn primary', disabled: !!p.busy || !proxyInput.trim(), onClick: async () => { const r = await p.call('gh.net.set', { proxy: proxyInput.trim(), scope: proxyScope }); if (r && r.ok) refreshNet() } }, '设置代理'),
            h('button', { className: 'ghcli-btn', disabled: !!p.busy, onClick: async () => { const r = await p.call('gh.net.auto', { scope: proxyScope }); if (r && r.ok) { if (net && net.systemProxy) setProxyInput(net.systemProxy); refreshNet() } } }, '自动使用系统代理'),
            h('button', { className: 'ghcli-btn', disabled: !!p.busy, onClick: async () => { await p.call('gh.net.test', {}) } }, '测试连接'),
            h('button', { className: 'ghcli-btn', disabled: !!p.busy, onClick: async () => { const r = await p.call('gh.net.clear', { scope: proxyScope }); if (r && r.ok) refreshNet() } }, '清除代理'),
          ),
          h('div', { className: 'ghcli-hint' }, '踩坑提示：git 不读 Windows 系统代理，网络受限环境下 push 会「直连超时」；用「自动使用系统代理」把系统代理写入 git 配置即可，随后点「测试连接」验证。'),
        ) : null,

        st && st.git ? h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, 'Git 全局配置'),
          h('div', { className: 'ghcli-row' }, h('span', { className: 'ghcli-hint' }, 'user.name：' + (st.git.name || '（未设置）')), h('span', { className: 'ghcli-hint' }, 'user.email：' + (st.git.email || '（未设置）'))),
        ) : null,
      )
    }

    function AccountTab(p) {
      const st = p.status
      const auth = st ? st.auth : null
      const accounts = (auth && auth.accounts) || []
      const active = auth ? auth.active : null
      const ghMissing = !!(st && !st.installed)

      const [token, setToken] = React.useState('')
      const [loginHost, setLoginHost] = React.useState('')
      const [gitName, setGitName] = React.useState('')
      const [gitEmail, setGitEmail] = React.useState('')

      React.useEffect(() => {
        if (st && st.git) {
          setGitName(st.git.name || '')
          setGitEmail(st.git.email || '')
        }
      }, [st])

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        ghMissing ? h('div', { className: 'ghcli-banner' }, h('span', { className: 'ghcli-hint' }, 'gh 未安装，请先在「状态与安装」页安装。')) : null,

        h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, '当前活跃账户'),
          active
            ? h('div', { className: 'ghcli-row' },
                active.avatarUrl
                  ? h('img', { className: 'ghcli-avatar', src: active.avatarUrl, alt: active.login })
                  : h('div', { className: 'ghcli-avatar', style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 } }, '👤'),
                h('div', { className: 'ghcli-field' },
                  h('div', { style: { fontWeight: 600 } }, active.login),
                  h('div', { className: 'ghcli-hint' }, (active.name || '') + (active.host ? ' @ ' + active.host : '')),
                ),
              )
            : h('div', { className: 'ghcli-hint' }, auth && auth.error ? '未登录或 gh 未认证：' + auth.error : '尚未登录 GitHub。'),
          !ghMissing ? h('div', { className: 'ghcli-row' },
            h('button', { className: 'ghcli-btn', disabled: !!p.busy || !active, onClick: () => p.call('gh.auth.refresh', { host: active ? (active.host || '') : '' }) }, '刷新 Token'),
          ) : null,
        ),

        h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, '登录 GitHub（Token 粘贴模式，避免交互式阻塞）'),
          h('div', { className: 'ghcli-field' },
            h('span', { className: 'ghcli-label' }, 'Personal Access Token'),
            h('input', { className: 'ghcli-input', type: 'password', placeholder: '粘贴 ghp_xxx / gho_xxx 令牌', value: token, onChange: (e) => setToken(e.target.value), disabled: !!p.busy }),
          ),
          h('div', { className: 'ghcli-field' },
            h('span', { className: 'ghcli-label' }, 'GH_HOST（企业版可选，留空为 github.com）'),
            h('input', { className: 'ghcli-input', placeholder: '例如 ghe.example.com', value: loginHost, onChange: (e) => setLoginHost(e.target.value), disabled: !!p.busy }),
          ),
          h('div', { className: 'ghcli-row' },
            h('button', { className: 'ghcli-btn primary', disabled: !!p.busy || !token.trim(), onClick: async () => {
              const res = await p.call('gh.auth.login', { token: token.trim(), host: loginHost.trim() }, { long: true })
              if (res && res.ok) { setToken(''); setLoginHost(''); p.refresh() }
            } }, '登录'),
          ),
          h('div', { className: 'ghcli-hint' }, '创建 Token：GitHub → Settings → Developer settings → Personal access tokens（需 repo 与 read:org 权限）。Token 仅经本机 gh 命令写入其凭证存储，不会上传。'),
        ),

        h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, '已登录账户（' + accounts.length + '）'),
          accounts.length === 0 ? h('div', { className: 'ghcli-hint' }, (auth && auth.error) || '暂无账户') : null,
          accounts.map((acc) =>
            h('div', { className: 'ghcli-acc', key: acc.host + '/' + acc.login },
              h('div', { className: 'ghcli-field' },
                h('div', { style: { fontWeight: 600 } }, acc.login + (acc.active ? '（当前）' : '')),
                h('div', { className: 'ghcli-hint' }, acc.host),
              ),
              h('button', { className: 'ghcli-btn', disabled: !!p.busy || acc.active, onClick: async () => { const r = await p.call('gh.auth.switch', { user: acc.login }); if (r && r.ok) p.refresh() } }, '切换'),
              h('button', { className: 'ghcli-btn danger', disabled: !!p.busy, onClick: async () => { const r = await p.call('gh.auth.logout', { user: acc.login, host: acc.host }); if (r && r.ok) p.refresh() } }, '登出'),
            ),
          ),
        ),

        h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, 'Git 全局配置（git config --global）'),
          h('div', { className: 'ghcli-field' },
            h('span', { className: 'ghcli-label' }, 'user.name'),
            h('input', { className: 'ghcli-input', placeholder: 'Git 用户名', value: gitName, onChange: (e) => setGitName(e.target.value), disabled: !!p.busy }),
          ),
          h('div', { className: 'ghcli-field' },
            h('span', { className: 'ghcli-label' }, 'user.email'),
            h('input', { className: 'ghcli-input', placeholder: 'Git 邮箱', value: gitEmail, onChange: (e) => setGitEmail(e.target.value), disabled: !!p.busy }),
          ),
          h('div', { className: 'ghcli-row' },
            h('button', { className: 'ghcli-btn primary', disabled: !!p.busy, onClick: async () => { const r = await p.call('gh.git.save', { name: gitName.trim(), email: gitEmail.trim() }); if (r && r.ok) p.refresh() } }, '保存'),
          ),
        ),
      )
    }

    function RepoTab(p) {
      const st = p.status
      const ghMissing = !!(st && !st.installed)

      const [repoInput, setRepoInput] = React.useState('')
      const [target, setTarget] = React.useState('')
      const [shallow, setShallow] = React.useState(false)
      const [pendingClone, setPendingClone] = React.useState(null)
      const [repoInfo, setRepoInfo] = React.useState(null)
      const [statusRepo, setStatusRepo] = React.useState('')
      const [remoteInfo, setRemoteInfo] = React.useState(null)
      const [forkRepo, setForkRepo] = React.useState('')
      const [createName, setCreateName] = React.useState('')
      const [createVis, setCreateVis] = React.useState('public')
      const [createSource, setCreateSource] = React.useState('')

      React.useEffect(() => {
        if (!p.workdir) return
        let alive = true
        host.call('gh.repo.current', { workdir: p.workdir }).then((res) => { if (alive && res) setRepoInfo(res) }).catch(() => {})
        return () => { alive = false }
      }, [p.workdir])

      async function refreshRepo() {
        if (!p.workdir) return
        const r = await host.call('gh.repo.current', { workdir: p.workdir })
        if (r) setRepoInfo(r)
      }

      async function doClone(force) {
        const res = await p.call('gh.repo.clone', { repo: repoInput.trim(), target: target.trim() || undefined, shallow, force }, { long: true })
        if (res && res.needsConfirm) setPendingClone(res)
        else if (res && res.ok) { setPendingClone(null); setRepoInput('') }
      }

      async function pickDir() {
        const dir = await p.pickDir()
        if (dir) setTarget(dir)
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        ghMissing ? h('div', { className: 'ghcli-banner' }, h('span', { className: 'ghcli-hint' }, 'gh 未安装：克隆 / Fork / 远程状态 / PR 依赖 gh，请先安装；本地 Push / Pull / 仓库检测仍可用。')) : null,

        h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, '克隆仓库'),
          h('div', { className: 'ghcli-field' },
            h('span', { className: 'ghcli-label' }, '仓库 owner/repo'),
            h('input', { className: 'ghcli-input', placeholder: '例如 cli/cli', value: repoInput, onChange: (e) => setRepoInput(e.target.value), disabled: !!p.busy }),
          ),
          h('div', { className: 'ghcli-field' },
            h('span', { className: 'ghcli-label' }, '目标目录（留空默认 ~/dsh/workspace/）'),
            h('div', { className: 'ghcli-row' },
              h('input', { className: 'ghcli-input', placeholder: '留空使用默认目录', value: target, onChange: (e) => setTarget(e.target.value), disabled: !!p.busy }),
              h('button', { className: 'ghcli-btn', onClick: pickDir }, '选择目录…'),
            ),
          ),
          h('div', { className: 'ghcli-row' },
            h('label', { className: 'ghcli-hint', style: { display: 'flex', alignItems: 'center', gap: 4 } },
              h('input', { type: 'checkbox', checked: shallow, onChange: (e) => setShallow(e.target.checked) }), '浅克隆（--depth 1）'),
            h('button', { className: 'ghcli-btn primary', disabled: !!p.busy || !repoInput.trim(), onClick: () => doClone(false) }, 'Clone'),
          ),
          pendingClone ? h('div', { className: 'ghcli-banner' },
            h('div', { style: { fontWeight: 600 } }, '目标目录非空，需确认'),
            h('div', { className: 'ghcli-hint' }, pendingClone.path + ' 已存在且非空。确认后会将原目录重命名为备份再克隆（不会删除原内容）。'),
            h('div', { className: 'ghcli-row' },
              h('button', { className: 'ghcli-btn danger', disabled: !!p.busy, onClick: () => doClone(true) }, '确认克隆（备份原目录）'),
              h('button', { className: 'ghcli-btn', onClick: () => setPendingClone(null) }, '取消'),
            ),
          ) : null,
        ),

        h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, '当前工作区仓库' + (p.workdir ? '：' + p.workdir : '')),
          !p.workdir ? h('div', { className: 'ghcli-hint' }, '未检测到工作区目录。') : null,
          repoInfo && repoInfo.inRepo
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { className: 'ghcli-row' },
                  h('span', { className: 'ghcli-badge ok' }, '分支 ' + (repoInfo.branch || '(detached)')),
                  h('span', { className: 'ghcli-hint' }, '未提交文件 ' + repoInfo.uncommitted + ' 个'),
                  repoInfo.remote ? h('span', { className: 'ghcli-hint', style: { maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, repoInfo.remote) : null,
                ),
                h('div', { className: 'ghcli-hint' }, repoInfo.hasUpstream
                  ? 'upstream 差异：领先 ' + repoInfo.ahead + ' / 落后 ' + repoInfo.behind
                  : '当前分支未设置 upstream（无远程跟踪）。'),
                h('div', { className: 'ghcli-row' },
                  h('button', { className: 'ghcli-btn', disabled: !!p.busy, onClick: async () => { const r = await p.call('gh.repo.push', { workdir: p.workdir }, { long: true }); if (r && r.ok) refreshRepo() } }, '⬆ Push'),
                  h('button', { className: 'ghcli-btn', disabled: !!p.busy, onClick: async () => { const r = await p.call('gh.repo.pull', { workdir: p.workdir }, { long: true }); if (r && r.ok) refreshRepo() } }, '⬇ Pull'),
                  h('button', { className: 'ghcli-btn primary', disabled: !!p.busy || !repoInfo.canCreatePr || ghMissing, title: repoInfo.canCreatePr ? '创建 PR' : '仅当分支领先 upstream 时可用', onClick: async () => { await p.call('gh.repo.pr', { workdir: p.workdir }, { long: true }) } }, 'Create PR'),
                  h('button', { className: 'ghcli-btn', disabled: !!p.busy || !repoInfo.remote, onClick: async () => { await p.call('gh.repo.open', { workdir: p.workdir }) } }, '打开远程页面'),
                ),
              )
            : h('div', { className: 'ghcli-hint' }, repoInfo ? '当前工作区不在 Git 仓库内。' : '正在检测…'),
        ),

        h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, '远程仓库状态'),
          h('div', { className: 'ghcli-row' },
            h('input', { className: 'ghcli-input', placeholder: 'owner/repo', value: statusRepo, onChange: (e) => setStatusRepo(e.target.value), disabled: !!p.busy }),
            h('button', { className: 'ghcli-btn', disabled: !!p.busy || !statusRepo.trim() || ghMissing, onClick: async () => { const r = await p.call('gh.repo.status', { repo: statusRepo.trim() }); if (r && r.ok) setRemoteInfo(r) } }, '查询'),
          ),
          remoteInfo ? h('div', { className: 'ghcli-row' },
            h('span', { className: 'ghcli-hint' }, '⭐ ' + remoteInfo.stars + ' ｜ 🍴 ' + remoteInfo.forks + ' ｜ 默认分支 ' + (remoteInfo.defaultBranch || '—')),
            h('span', { className: 'ghcli-hint' }, '最后推送：' + (remoteInfo.pushedAt || '未知')),
            remoteInfo.htmlUrl ? h('a', { className: 'ghcli-btn', href: remoteInfo.htmlUrl, target: '_blank', rel: 'noreferrer' }, '打开仓库') : null,
          ) : null,
        ),

        h('div', { className: 'ghcli-card' },
          h('div', { className: 'ghcli-label' }, 'Fork 与创建'),
          h('div', { className: 'ghcli-field' },
            h('span', { className: 'ghcli-label' }, 'Fork 仓库（owner/repo，可勾选克隆到目标目录）'),
            h('div', { className: 'ghcli-row' },
              h('input', { className: 'ghcli-input', placeholder: '例如 cli/cli', value: forkRepo, onChange: (e) => setForkRepo(e.target.value), disabled: !!p.busy }),
              h('button', { className: 'ghcli-btn', disabled: !!p.busy || !forkRepo.trim() || ghMissing, onClick: async () => { const r = await p.call('gh.repo.fork', { repo: forkRepo.trim(), clone: true, target: target.trim() || undefined }, { long: true }); if (r && r.ok) setForkRepo('') } }, 'Fork（并克隆）'),
            ),
          ),
          h('div', { className: 'ghcli-field' },
            h('span', { className: 'ghcli-label' }, '创建新仓库（基于本地目录，自动 git init + push）'),
            h('div', { className: 'ghcli-row' },
              h('input', { className: 'ghcli-input', placeholder: '仓库名（如 my-project）', value: createName, onChange: (e) => setCreateName(e.target.value), disabled: !!p.busy }),
              h('select', { className: 'ghcli-input', style: { flex: '0 0 auto', width: 110 }, value: createVis, onChange: (e) => setCreateVis(e.target.value) },
                h('option', { value: 'public' }, 'public'),
                h('option', { value: 'private' }, 'private'),
              ),
              h('button', { className: 'ghcli-btn', disabled: !!p.busy || !createName.trim() || ghMissing, onClick: async () => { const r = await p.call('gh.repo.create', { name: createName.trim(), visibility: createVis, source: createSource.trim() || p.workdir || undefined }, { long: true }); if (r && r.ok) setCreateName('') } }, '创建'),
            ),
            h('input', { className: 'ghcli-input', placeholder: '来源目录（留空用当前工作区）', value: createSource, onChange: (e) => setCreateSource(e.target.value), disabled: !!p.busy }),
          ),
        ),
      )
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'ghcli', order: 60, label: 'GitHub CLI' },
      (slotProps) => h(GhSettings, { close: slotProps.close, useWorkspaces: slotProps.useWorkspaces }),
    ))
  },
}
