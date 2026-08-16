// dsh-ghCLI · Host 半区（标准 DSH 插件 main 入口）
// 原动态 Cordis Plugin（ghcli-1）代码已迁移为标准插件包形态：
//   main 指向本文件，导出 { name, inject, apply }，由 cordis loader 直接加载；
//   gh.* RPC 由动态的 harness.handle() 改为标准 ctx.webServer 的 /api/dsh-ghcli/* 路由。
// 模块映射（与 README §2 一致）：
//   gh-executor     -> runArgv / readAll / resolveExe
//   gh-detector     -> ensureEnv / detectGh / detectInstallers / installGh
//   gh-auth-manager -> authStatus / authLogin / authSwitch / authLogout / authRefresh
//   git-manager     -> repoCurrent / repoClone / repoStatus / repoFork / repoCreate /
//                      repoOpenRemote / repoPush / repoPull / repoPrCreate
//   routes          -> 底部 routes 数组注册的 gh.* HTTP 接口
// 依赖服务：subprocess（执行）、timer（超时/取消）、fs（目录探测，可选）、
//          webServer（路由）、systemPrompt（agent 通告，可选）。
export const name = 'ghcli'

/** Services required before the gh surfaces can mount. */
export const inject = ['webServer']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const GHLI_GUIDANCE = '本机已安装 dsh-ghcli 插件（GitHub CLI 管理）：设置页（侧边栏 → 设置 → GitHub CLI）提供 gh 安装检测/自愈（含 Windows 网络代理自愈）、多账户认证管理（Token 登录/切换/登出/刷新）、Git 仓库高频操作（克隆/当前仓库 Push/Pull/Create PR/打开远程/远程状态/Fork/创建）。底层直接调用本机 gh 与 git 命令；认证 Token 仅经 gh 命令写入本机凭证存储，不上传。用户提到「gh / GitHub CLI / 克隆仓库 / 创建 PR / git 代理」等词时即指本插件。'

/**
 * Mount the gh/git engine and its /api/dsh-ghcli route family.
 * @param ctx - host plugin context carrying webServer (plus optional subprocess/timer/fs).
 */
export function apply(ctx) {
  const sub = ctx.get('subprocess')
  const timerSvc = ctx.get('timer')
  const fsSvc = ctx.get('fs')

  const state = {
    env: null,            // { platform, home }，惰性探测并缓存
    lastDetect: null,
    ghBin: null,          // 解析到的 gh 可执行文件绝对路径；null 表示未找到
    ghBinInit: false,     // ghBin 是否已解析（三态避免重复探测）
    pathSource: null,     // ghBin 来源：'path' | 'manual' | 'registry' | 'known' | null
    manualPath: null,     // 用户手动指定的 gh 路径（exe 或目录）
    activeOps: new Map(), // opId -> { terminate, label }
    opSeq: 0,
  }

  // ================= gh-executor =================
  async function resolveExe(name) {
    try {
      return await sub.resolveExecutable(name)
    } catch (e) {
      return null
    }
  }

  async function readAll(reader) {
    if (!reader) return ''
    const read = reader.readFrom(0)
    if (!read.lossy) return read.text || ''
    if (read.spillPath && fsSvc) {
      try {
        const target = await fsSvc.resolve(read.spillPath)
        return await fsSvc.readText(target)
      } catch (e) {
        // spill 读取尽力而为
      }
    }
    return read.text || ''
  }

  async function runArgv(argv, opts = {}) {
    const timeoutMs = opts.timeoutMs == null ? 30000 : opts.timeoutMs
    const cwd = opts.cwd || (state.env ? state.env.home : null) || '.'
    let handle = null
    try {
      handle = sub.spawn({
        argv,
        cwd,
        stdio: {
          stdin: opts.stdin != null ? { data: String(opts.stdin) } : 'ignore',
          stdout: { maxBytes: opts.stdoutMaxBytes || 4 * 1024 * 1024, spill: { maxBytes: 32 * 1024 * 1024 } },
          stderr: { maxBytes: 2 * 1024 * 1024, spill: { maxBytes: 16 * 1024 * 1024 } },
        },
        graceMs: 5000,
        env: opts.env || undefined,
      })
    } catch (e) {
      const msg = String((e && e.message) || e)
      console.error(`gh exec 启动失败: ${argv.join(' ')} :: ${msg}`)
      return { exitCode: -1, signal: null, timedOut: false, cancelled: false, spawnError: msg, stdout: '', stderr: '' }
    }
    let timedOut = false
    let cancelled = false
    const opId = opts.opId
    if (opId) {
      state.activeOps.set(opId, {
        label: argv.join(' '),
        terminate: () => {
          cancelled = true
          try { handle.terminate() } catch (e) { /* noop */ }
        },
      })
    }
    let timerDispose = null
    if (timeoutMs > 0 && timerSvc) {
      timerDispose = timerSvc.timeout(() => {
        timedOut = true
        try { handle.terminate() } catch (e) { /* noop */ }
      }, timeoutMs)
    }
    let outcome
    try {
      outcome = await handle.done
    } finally {
      if (timerDispose) timerDispose()
      if (opId) state.activeOps.delete(opId)
    }
    const stdout = await readAll(handle.collected.stdout)
    const stderr = await readAll(handle.collected.stderr)
    console.log(`gh exec: ${argv.join(' ')} -> exit=${outcome.exitCode} signal=${outcome.signal} timedOut=${timedOut} cancelled=${cancelled} stdout=${stdout.length}B stderr=${stderr.length}B`)
    if (stderr) console.log(`gh exec stderr: ${stderr.slice(0, 4000)}`)
    if (stdout && stdout.length <= 2000) console.log(`gh exec stdout: ${stdout}`)
    return { exitCode: outcome.exitCode, signal: outcome.signal, timedOut, cancelled, spawnError: null, stdout, stderr }
  }

  function joinPath(...parts) {
    const sep = state.env && state.env.platform === 'windows' ? '\\' : '/'
    const kept = parts.filter((p) => p != null && String(p) !== '')
    if (!kept.length) return ''
    let out = String(kept[0])
    for (let i = 1; i < kept.length; i++) {
      out = out.replace(/[\\/]+$/, '') + sep + String(kept[i]).replace(/^[\\/]+/, '')
    }
    return out
  }

  function timestamp() {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  }

  function toWebUrl(u) {
    if (!u) return null
    if (/^https?:\/\//.test(u)) return u.replace(/\.git$/, '')
    const m = /^(?:git@|ssh:\/\/git@)([\w.-]+):([\w./-]+?)(?:\.git)?$/.exec(u)
    if (m) return 'https://' + m[1] + '/' + m[2]
    return null
  }

  // ================= gh-detector =================
  async function ensureEnv() {
    if (state.env) return state.env
    let platform = 'posix'
    if (await resolveExe('cmd')) platform = 'windows'
    let home = ''
    let localAppData = ''
    try {
      if (platform === 'windows') {
        const [u, l] = await Promise.all([
          runArgv(['cmd', '/c', 'echo', '%USERPROFILE%'], { timeoutMs: 15000 }),
          runArgv(['cmd', '/c', 'echo', '%LOCALAPPDATA%'], { timeoutMs: 15000 }),
        ])
        home = (u.stdout || '').trim()
        localAppData = (l.stdout || '').trim()
      } else {
        const r = await runArgv(['sh', '-c', 'echo $HOME'], { timeoutMs: 15000 })
        home = (r.stdout || '').trim()
      }
    } catch (e) {
      // 保持空
    }
    state.env = { platform, home, localAppData }
    console.log(`gh env: platform=${platform} home=${home || '(unknown)'}`)
    return state.env
  }

  // gh 可执行文件解析：PATH 优先，其次用户手动指定路径（exe 或目录均可）
  async function resolveGhPath(input) {
    const p = String(input || '').trim()
    if (!p) return null
    let r = await resolveExe(p)
    if (r) return r
    await ensureEnv()
    const sep = state.env.platform === 'windows' ? '\\' : '/'
    const base = p.replace(/[\\/]+$/, '')
    const names = state.env.platform === 'windows' ? ['gh.exe', 'gh'] : ['gh']
    for (const n of names) {
      r = await resolveExe(base + sep + n)
      if (r) return r
    }
    return null
  }

  // Windows：合并注册表中的用户与系统 PATH（新加的目录立即可见，无需重启宿主进程），
  // 并展开 %VAR% 占位符；返回合并后的 PATH 字符串，失败返回 null。
  // 用于解决「用户已添加环境变量，但 DSH 宿主进程启动更早、其 PATH 陈旧」的场景。
  async function readFreshWindowsPath() {
    await ensureEnv()
    if (state.env.platform !== 'windows') return null
    // 首选 PowerShell（Windows 10+ 自带）：一次读取机器 + 用户 PATH 并展开
    const psCmd = "$m=[Environment]::GetEnvironmentVariable('Path','Machine');$u=[Environment]::GetEnvironmentVariable('Path','User');if($m -or $u){[Environment]::ExpandEnvironmentVariables(($m+';'+$u))}"
    const ps = await runArgv(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', psCmd], { timeoutMs: 20000 })
    if (ps.exitCode === 0 && (ps.stdout || '').trim()) return (ps.stdout || '').trim().replace(/\r?\n/g, '')
    // 回退：reg query 读原始值 + 用进程环境展开 %VAR%
    const parts = []
    for (const hive of ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment']) {
      const q = await runArgv(['cmd', '/c', 'reg', 'query', hive, '/v', 'Path'], { timeoutMs: 15000 })
      if (q.exitCode === 0) {
        const m = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(q.stdout || '')
        if (m) parts.push(m[1].trim())
      }
    }
    if (!parts.length) return null
    const setR = await runArgv(['cmd', '/c', 'set'], { timeoutMs: 15000 })
    const vars = {}
    for (const line of (setR.stdout || '').split('\n')) {
      const i = line.indexOf('=')
      if (i > 0) vars[line.slice(0, i)] = line.slice(i + 1).trim()
    }
    return parts.join(';').replace(/%([^%]+)%/g, (m, k) => (vars[k] != null ? vars[k] : m))
  }

  // 常见 gh 安装目录探测（PATH 与注册表都失败时的最后兜底）
  async function probeKnownGhLocations() {
    await ensureEnv()
    const env = state.env
    const locs = []
    if (env.platform === 'windows') {
      if (env.localAppData) {
        locs.push(
          joinPath(env.localAppData, 'Programs', 'gh-cli', 'bin', 'gh.exe'),
          joinPath(env.localAppData, 'Programs', 'GitHub CLI', 'gh.exe'),
          joinPath(env.localAppData, 'GitHubDesktop', 'bin', 'gh.exe'),
        )
      }
      if (env.home) locs.push(joinPath(env.home, 'scoop', 'shims', 'gh.exe'))
      locs.push(
        joinPath('C:', 'Program Files', 'GitHub CLI', 'gh.exe'),
        joinPath('C:', 'Program Files (x86)', 'GitHub CLI', 'gh.exe'),
        joinPath('C:', 'Program Files', 'GitHub Desktop', 'bin', 'gh.exe'),
      )
    } else {
      locs.push('/usr/local/bin/gh', '/opt/homebrew/bin/gh', '/usr/bin/gh', '/snap/bin/gh')
      if (env.home) locs.push(joinPath(env.home, '.local', 'bin', 'gh'))
    }
    for (const loc of locs) {
      if (!loc) continue
      const r = await resolveExe(loc)
      if (r) return r
    }
    return null
  }

  // gh 可执行文件解析（三级兜底）：
  //   1) 进程 PATH（DSH 重启后用户新加的环境变量天然可见）
  //   2) 注册表里的用户 + 系统 PATH（Windows 专用，无需重启 DSH，读取后展开 %VAR%）
  //   3) 常见安装目录探测（winget / 便携版 / GitHub Desktop / scoop 等）
  async function ensureGhBin(force) {
    if (force) {
      state.ghBin = null
      state.ghBinInit = false
      state.pathSource = null
      state.lastDetect = null
    }
    if (state.ghBinInit) return state.ghBin
    let p = await resolveExe('gh')
    let source = p ? 'path' : null
    if (!p && state.manualPath) {
      p = await resolveGhPath(state.manualPath)
      if (p) source = 'manual'
    }
    if (!p) {
      const freshPath = await readFreshWindowsPath()
      if (freshPath) {
        p = await resolveExe('gh', { PATH: freshPath })
        if (p) source = 'registry'
      }
    }
    if (!p) {
      p = await probeKnownGhLocations()
      if (p) source = 'known'
    }
    state.ghBin = p || null
    state.ghBinInit = true
    state.pathSource = source
    return state.ghBin
  }

  // 构造 gh 命令 argv：有解析到绝对路径则用之，否则退回 PATH 里的 'gh'
  function ghArgv() {
    const args = Array.prototype.slice.call(arguments)
    return state.ghBin ? [state.ghBin].concat(args) : ['gh'].concat(args)
  }

  async function detectGh(force) {
    const ghPath = await ensureGhBin(force)
    let version = null
    let installed = false
    if (ghPath) {
      const r = await runArgv(ghArgv('--version'), { timeoutMs: 15000 })
      if (r.exitCode === 0) {
        installed = true
        const m = /gh version\s+(\S+)/i.exec(r.stdout || '')
        version = m ? m[1] : (r.stdout || '').split('\n')[0]
      }
    }
    const d = { installed, path: ghPath, version, pathSource: state.pathSource || null }
    state.lastDetect = d
    return d
  }

  async function detectInstallers() {
    const out = []
    if (await resolveExe('winget')) out.push('winget')
    if (await resolveExe('brew')) out.push('brew')
    if (await resolveExe('apt-get')) out.push('apt')
    return out
  }

  async function installGh(opId) {
    const installers = await detectInstallers()
    const installer = installers[0]
    if (!installer) return { ok: false, error: '未检测到 winget / brew / apt-get，请使用手动安装指引。', installers }
    let argv = null
    if (installer === 'winget') argv = ['winget', 'install', '--id', 'GitHub.cli', '-e', '--accept-source-agreements', '--accept-package-agreements']
    else if (installer === 'brew') argv = ['brew', 'install', 'gh']
    else argv = ['sudo', 'apt-get', 'install', '-y', 'gh']
    const r = await runArgv(argv, { timeoutMs: 300000, opId: opId || 'install-' + (++state.opSeq) })
    const d = await detectGh(true) // 强制重检：winget 装完立即可识别，无需重启 DSH
    const ok = r.exitCode === 0 || d.installed
    return { ok, exitCode: r.exitCode, installer, installed: d.installed, version: d.version, message: (r.stdout + '\n' + r.stderr).trim() || (ok ? '安装完成' : '安装失败') }
  }

  // ================= gh-auth-manager =================
  async function authStatus() {
    const d = await detectGh()
    if (!d.installed) return { ok: false, error: 'gh 未安装', accounts: [], active: null }
    const r = await runArgv(ghArgv('auth', 'status'), { timeoutMs: 30000 })
    const text = ((r.stdout || '') + '\n' + (r.stderr || '')).trim()
    const accounts = []
    let current = null
    const lines = text.split('\n')
    for (const line of lines) {
      const lm = /Logged in to ([\w.-]+) (?:as|account) ([^\s✓]+)/i.exec(line)
      if (lm) {
        current = { host: lm[1], login: lm[2], active: false }
        accounts.push(current)
        continue
      }
      if (current && /Active account[:\s]*true/i.test(line)) current.active = true
    }
    let active = null
    const u = await runArgv(ghArgv('api', 'user', '--jq', '{login: .login, name: .name, avatarUrl: .avatar_url}'), { timeoutMs: 30000 })
    if (u.exitCode === 0) {
      try { active = JSON.parse(u.stdout) } catch (e) { active = null }
    }
    const activeFromList = accounts.find((a) => a.active) || null
    if (activeFromList && active) active.host = activeFromList.host
    if (activeFromList && !active) active = { login: activeFromList.login, host: activeFromList.host, name: null, avatarUrl: null }
    return { ok: true, accounts, active, raw: text }
  }

  async function authLogin(args) {
    await ensureGhBin()
    const token = String(args.token || '').trim()
    if (!token) return { ok: false, error: '请输入 Token' }
    const env = args.host ? { GH_HOST: String(args.host).trim() } : undefined
    const r = await runArgv(ghArgv('auth', 'login', '--with-token'), { stdin: token + '\n', env, timeoutMs: 60000, opId: args.opId || 'login-' + (++state.opSeq) })
    return { ok: r.exitCode === 0, message: (r.stdout + '\n' + r.stderr).trim() || '登录成功' }
  }

  async function authSwitch(args) {
    await ensureGhBin()
    const user = String(args.user || '').trim()
    if (!user) return { ok: false, error: '缺少用户名' }
    const r = await runArgv(ghArgv('auth', 'switch', '--user', user), { timeoutMs: 30000 })
    return { ok: r.exitCode === 0, message: (r.stdout + '\n' + r.stderr).trim() || ('已切换至 ' + user) }
  }

  async function authLogout(args) {
    await ensureGhBin()
    const user = String(args.user || '').trim()
    if (!user) return { ok: false, error: '缺少用户名' }
    const argv = args.host ? ghArgv('auth', 'logout', '-h', String(args.host), '-u', user) : ghArgv('auth', 'logout', '-u', user)
    const r = await runArgv(argv, { timeoutMs: 30000 })
    return { ok: r.exitCode === 0, message: (r.stdout + '\n' + r.stderr).trim() || ('已登出 ' + user) }
  }

  async function authRefresh(args) {
    await ensureGhBin()
    const argv = args.host ? ghArgv('auth', 'refresh', '-h', String(args.host)) : ghArgv('auth', 'refresh')
    const r = await runArgv(argv, { timeoutMs: 60000 })
    return { ok: r.exitCode === 0, message: (r.stdout + '\n' + r.stderr).trim() || 'Token 已刷新' }
  }

  async function gitConfigGet(key) {
    const r = await runArgv(['git', 'config', '--global', '--get', key], { timeoutMs: 15000 })
    return r.exitCode === 0 ? (r.stdout || '').trim() : ''
  }

  async function gitConfigSet(key, value) {
    if (value === '') {
      const r = await runArgv(['git', 'config', '--global', '--unset-all', key], { timeoutMs: 15000 })
      return { ok: r.exitCode === 0, message: r.exitCode === 0 ? '已清除' : (r.stderr || '').trim() }
    }
    const r = await runArgv(['git', 'config', '--global', key, value], { timeoutMs: 15000 })
    return { ok: r.exitCode === 0, message: r.exitCode === 0 ? '' : (r.stderr || '').trim() }
  }

  // ================= git-manager =================
  async function repoCurrent(workdir) {
    const dir = workdir || (state.env ? state.env.home : null)
    if (!dir) return { ok: true, inRepo: false, workdir: null }
    const inside = await runArgv(['git', 'rev-parse', '--is-inside-work-tree'], { cwd: dir, timeoutMs: 15000 })
    if (inside.exitCode !== 0) return { ok: true, inRepo: false, workdir: dir }
    const [branchR, statusR, remoteR, upstreamR, aheadR] = await Promise.all([
      runArgv(['git', 'branch', '--show-current'], { cwd: dir, timeoutMs: 15000 }),
      runArgv(['git', 'status', '--porcelain'], { cwd: dir, timeoutMs: 15000 }),
      runArgv(['git', 'remote', 'get-url', 'origin'], { cwd: dir, timeoutMs: 15000 }),
      runArgv(['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: dir, timeoutMs: 15000 }),
      runArgv(['git', 'rev-list', '--left-right', '--count', '@{u}...HEAD'], { cwd: dir, timeoutMs: 15000 }),
    ])
    const branch = (branchR.stdout || '').trim()
    const uncommitted = (statusR.stdout || '').split('\n').filter((s) => s.trim() !== '').length
    const remote = remoteR.exitCode === 0 ? (remoteR.stdout || '').trim() : ''
    const hasUpstream = upstreamR.exitCode === 0
    let ahead = 0
    let behind = 0
    if (aheadR.exitCode === 0) {
      const parts = (aheadR.stdout || '').trim().split(/\s+/)
      behind = parseInt(parts[0], 10) || 0
      ahead = parseInt(parts[1], 10) || 0
    }
    return { ok: true, inRepo: true, workdir: dir, branch, uncommitted, remote, hasUpstream, ahead, behind, canCreatePr: hasUpstream && ahead > 0 }
  }

  async function dirStatus(path) {
    if (fsSvc) {
      try {
        const target = await fsSvc.resolve(path)
        const info = await fsSvc.stat(target)
        if (!info || info.type !== 'directory') return 'missing'
        const entries = await fsSvc.listDir(target)
        return entries.length > 0 ? 'nonempty' : 'empty'
      } catch (e) {
        // 回落到命令行探测
      }
    }
    await ensureEnv()
    if (state.env.platform === 'windows') {
      const r = await runArgv(['cmd', '/c', 'dir', '/b', path], { timeoutMs: 15000 })
      if (r.exitCode !== 0) return 'missing'
      return (r.stdout || '').trim() ? 'nonempty' : 'empty'
    }
    const r = await runArgv(['sh', '-c', 'if [ -d "$1" ]; then if ls -A "$1" | grep -q .; then echo NONEMPTY; else echo EMPTY; fi; else echo MISSING; fi', 'sh', path], { timeoutMs: 15000 })
    const out = (r.stdout || '').trim()
    if (out === 'NONEMPTY') return 'nonempty'
    if (out === 'EMPTY') return 'empty'
    return 'missing'
  }

  async function movePath(src, dest) {
    await ensureEnv()
    if (state.env.platform === 'windows') {
      const parts = dest.split(/[\\/]+/).filter(Boolean)
      const newName = parts[parts.length - 1]
      return runArgv(['cmd', '/c', 'ren', src, newName], { timeoutMs: 30000 })
    }
    return runArgv(['mv', src, dest], { timeoutMs: 30000 })
  }

  async function repoClone(args) {
    await ensureGhBin()
    const repo = String(args.repo || '').trim()
    if (!repo) return { ok: false, error: '请输入仓库（owner/repo）' }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: '仓库格式应为 owner/repo' }
    await ensureEnv()
    const base = args.target || joinPath(state.env.home, 'dsh', 'workspace')
    const dirName = repo.split('/')[1]
    const dest = joinPath(base, dirName)
    const ds = await dirStatus(dest)
    if (ds === 'nonempty' && !args.force) {
      // 自检 2：目标目录非空时绝不强制覆盖，必须回传 needsConfirm 由 UI 弹确认框
      return { ok: false, needsConfirm: true, path: dest, message: '目标目录已存在且非空' }
    }
    if (ds === 'nonempty' && args.force) {
      const backup = dest + '.dsh-backup-' + timestamp()
      const mv = await movePath(dest, backup)
      if (mv.exitCode !== 0) return { ok: false, error: '备份原目录失败：' + ((mv.stderr || mv.stdout || '').trim()) }
    }
    const argv = ghArgv('repo', 'clone', repo, dest)
    if (args.shallow) argv.push('--', '--depth', '1')
    const r = await runArgv(argv, { timeoutMs: 300000, opId: args.opId || 'clone-' + (++state.opSeq), stdoutMaxBytes: 8 * 1024 * 1024 })
    if (r.exitCode !== 0) {
      return { ok: false, error: (r.stderr || r.stdout || '').trim() || '克隆失败' }
    }
    return { ok: true, path: dest, message: '已克隆到 ' + dest }
  }

  async function repoStatus(repo) {
    await ensureGhBin()
    if (!repo) return { ok: false, error: '请输入仓库（owner/repo）' }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: '仓库格式应为 owner/repo' }
    const r = await runArgv(ghArgv('api', 'repos/' + repo, '--jq', '{stars: .stargazers_count, forks: .forks_count, pushedAt: .pushed_at, description: .description, htmlUrl: .html_url, defaultBranch: .default_branch, archived: .archived}'), { timeoutMs: 30000 })
    if (r.exitCode !== 0) {
      const err = (r.stderr || '').trim()
      return { ok: false, error: err || '查询失败（仓库不存在或权限不足）' }
    }
    try {
      const data = JSON.parse(r.stdout)
      return { ok: true, stars: data.stars, forks: data.forks, pushedAt: data.pushedAt, description: data.description, htmlUrl: data.htmlUrl, defaultBranch: data.defaultBranch, archived: data.archived }
    } catch (e) {
      return { ok: false, error: '无法解析仓库数据：' + String((e && e.message) || e) }
    }
  }

  async function repoFork(args) {
    await ensureGhBin()
    const repo = String(args.repo || '').trim()
    if (!repo) return { ok: false, error: '请输入仓库（owner/repo）' }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: '仓库格式应为 owner/repo' }
    await ensureEnv()
    const r = await runArgv(ghArgv('repo', 'fork', repo), { timeoutMs: 120000, opId: args.opId || 'fork-' + (++state.opSeq) })
    const name = repo.split('/')[1]
    const u = await runArgv(ghArgv('api', 'user', '--jq', '.login'), { timeoutMs: 30000 })
    const login = u.exitCode === 0 ? (u.stdout || '').trim() : null
    const combined = ((r.stderr || '') + (r.stdout || '')).trim()
    const already = r.exitCode !== 0 && /already exists|already fork|已存在|已 fork/i.test(combined)
    if (r.exitCode !== 0 && !already) return { ok: false, error: combined || 'Fork 失败' }
    const forkUrl = login ? 'https://github.com/' + login + '/' + name : null
    let cloneMsg = ''
    if (args.clone && login) {
      const base = args.target || joinPath(state.env.home, 'dsh', 'workspace')
      const dest = joinPath(base, name)
      const cr = await runArgv(ghArgv('repo', 'clone', login + '/' + name, dest), { timeoutMs: 300000, opId: 'forkclone-' + (++state.opSeq) })
      cloneMsg = cr.exitCode === 0 ? '；已克隆到 ' + dest : '；克隆失败：' + ((cr.stderr || cr.stdout || '').trim())
    }
    return { ok: true, forkUrl, message: (already ? '仓库已 Fork，已切换至 fork 地址' : 'Fork 成功') + (forkUrl ? '：' + forkUrl : '') + cloneMsg }
  }

  async function repoCreate(args) {
    await ensureGhBin()
    const name = String(args.name || '').trim()
    if (!name) return { ok: false, error: '请输入仓库名' }
    await ensureEnv()
    const src = args.source || state.env.home || '.'
    const init = await runArgv(['git', 'rev-parse', '--is-inside-work-tree'], { cwd: src, timeoutMs: 15000 })
    if (init.exitCode !== 0) {
      const g = await runArgv(['git', 'init'], { cwd: src, timeoutMs: 15000 })
      if (g.exitCode !== 0) return { ok: false, error: '本地目录初始化 Git 失败：' + ((g.stderr || '').trim()) }
    }
    const vis = args.visibility === 'private' ? '--private' : '--public'
    const r = await runArgv(ghArgv('repo', 'create', name, vis, '--source', src, '--push'), { timeoutMs: 300000, opId: args.opId || 'create-' + (++state.opSeq) })
    if (r.exitCode !== 0) return { ok: false, error: (r.stderr || r.stdout || '').trim() || '创建失败' }
    const out = (r.stdout || '').trim()
    const m = /(https:\/\/[^\s]+)/.exec(out)
    return { ok: true, url: m ? m[1] : '', message: out || '创建成功' }
  }

  async function repoOpenRemote(workdir) {
    const dir = workdir || (state.env ? state.env.home : null)
    if (!dir) return { ok: false, error: '缺少工作目录' }
    const r = await runArgv(['git', 'remote', 'get-url', 'origin'], { cwd: dir, timeoutMs: 15000 })
    if (r.exitCode !== 0) return { ok: false, error: '当前仓库没有 origin 远程地址' }
    const url = toWebUrl((r.stdout || '').trim())
    if (!url) return { ok: false, error: '无法解析 remote URL' }
    await ensureEnv()
    if (state.env.platform === 'windows') {
      const o = await runArgv(['cmd', '/c', 'start', '', url], { timeoutMs: 15000 })
      if (o.exitCode !== 0) return { ok: false, error: (o.stderr || '').trim() || '打开浏览器失败' }
    } else {
      const o = await runArgv(['xdg-open', url], { timeoutMs: 15000 })
      if (o.exitCode !== 0) return { ok: false, error: (o.stderr || '').trim() || '打开浏览器失败' }
    }
    return { ok: true, url, message: '已打开 ' + url }
  }

  async function repoPush(workdir) {
    const dir = workdir || (state.env ? state.env.home : null)
    if (!dir) return { ok: false, error: '缺少工作目录' }
    const r = await runArgv(['git', 'push'], { cwd: dir, timeoutMs: 120000, opId: 'push-' + (++state.opSeq) })
    const msg = (r.stdout + '\n' + r.stderr).trim() || 'push 完成'
    return { ok: r.exitCode === 0, error: r.exitCode !== 0 ? msg : undefined, message: msg }
  }

  async function repoPull(workdir) {
    const dir = workdir || (state.env ? state.env.home : null)
    if (!dir) return { ok: false, error: '缺少工作目录' }
    const r = await runArgv(['git', 'pull'], { cwd: dir, timeoutMs: 120000, opId: 'pull-' + (++state.opSeq) })
    const msg = (r.stdout + '\n' + r.stderr).trim() || 'pull 完成'
    return { ok: r.exitCode === 0, error: r.exitCode !== 0 ? msg : undefined, message: msg }
  }

  async function repoPrCreate(workdir) {
    await ensureGhBin()
    const dir = workdir || (state.env ? state.env.home : null)
    if (!dir) return { ok: false, error: '缺少工作目录' }
    const r = await runArgv(ghArgv('pr', 'create', '--fill'), { cwd: dir, timeoutMs: 120000, opId: 'pr-' + (++state.opSeq) })
    if (r.exitCode !== 0) return { ok: false, error: (r.stderr || '').trim() || 'PR 创建失败' }
    const out = (r.stdout || '').trim()
    const m = /(https:\/\/[^\s]+)/.exec(out)
    return { ok: true, url: m ? m[1] : '', message: out || 'PR 已创建' }
  }

  // ================= 手动路径 & PATH 写入（gh 不在 PATH 时的兜底） =================
  async function setManualPath(input) {
    const p = String(input || '').trim()
    if (!p) {
      state.manualPath = null
      state.ghBin = null
      state.ghBinInit = false
      state.lastDetect = null
      return { ok: true, message: '已清除手动路径，恢复自动检测', path: null }
    }
    const resolved = await resolveGhPath(p)
    if (!resolved) return { ok: false, error: '未在指定位置找到 gh 可执行文件：' + p }
    state.manualPath = resolved
    state.ghBin = resolved
    state.ghBinInit = true
    state.lastDetect = null
    const d = await detectGh()
    return {
      ok: true,
      path: resolved,
      version: d.version,
      installed: d.installed,
      message: d.installed ? ('已使用 gh：' + resolved + (d.version ? '（v' + d.version + '）' : '')) : ('路径可用，但 gh --version 执行异常：' + resolved),
    }
  }

  // 把 gh 所在目录加入 PATH：Windows 写用户环境变量（HKCU\Environment\Path），
  // POSIX 追加到 ~/.bashrc / ~/.zshrc。当前进程 PATH 不会立即刷新，
  // 因此成功后把该目录设为手动路径，本会话即刻生效。
  async function addToPath(dir) {
    await ensureEnv()
    if (!dir) return { ok: false, error: '缺少目录' }
    // 若输入的是可执行文件路径（gh.exe / gh），取其所在目录
    const targetDir = /[\\/]gh(?:\.exe)?$/i.test(dir) ? dir.replace(/[\\/][^\\/]+$/, '') : dir.replace(/[\\/]+$/, '')
    if (state.env.platform === 'windows') {
      const q = await runArgv(['cmd', '/c', 'reg', 'query', 'HKCU\\Environment', '/v', 'Path'], { timeoutMs: 15000 })
      let current = ''
      if (q.exitCode === 0) {
        const m = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(q.stdout || '')
        if (m) current = m[1].trim()
      }
      const norm = (s) => String(s || '').toLowerCase().replace(/[\\/]+$/, '')
      const exists = current.split(';').some((e) => norm(e.trim()) === norm(targetDir))
      if (exists) return { ok: true, message: '目录已在用户 PATH 中：' + targetDir }
      const esc = (s) => s.replace(/%/g, '%%')
      const next = (current ? esc(current) + ';' : '') + esc(targetDir)
      const a = await runArgv(['cmd', '/c', 'reg', 'add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', next, '/f'], { timeoutMs: 15000 })
      if (a.exitCode !== 0) return { ok: false, error: (a.stderr || a.stdout || '').trim() || '写入用户 PATH 失败' }
    } else {
      const rcName = state.env.platform === 'mac' ? '.zshrc' : '.bashrc'
      const rcPath = joinPath(state.env.home, rcName)
      const line = 'export PATH="$PATH:' + targetDir + '"'
      const check = await runArgv(['sh', '-c', 'grep -qF "$1" "$2" 2>/dev/null && echo YES || echo NO', 'sh', line, rcPath], { timeoutMs: 15000 })
      if ((check.stdout || '').trim() === 'YES') return { ok: true, message: rcPath + ' 已包含该路径' }
      const a = await runArgv(['sh', '-c', 'echo "$1" >> "$2"', 'sh', line, rcPath], { timeoutMs: 15000 })
      if (a.exitCode !== 0) return { ok: false, error: (a.stderr || a.stdout || '').trim() || '写入 ' + rcPath + ' 失败' }
    }
    // 本会话立即启用
    const resolved = await resolveGhPath(targetDir)
    if (resolved) {
      state.manualPath = resolved
      state.ghBin = resolved
      state.ghBinInit = true
      state.lastDetect = null
    }
    return {
      ok: true,
      message: state.env.platform === 'windows'
        ? '已加入用户 PATH：' + targetDir + '（新终端 / 重启 DSH 后全局生效；本会话已立即启用）'
        : '已追加到 ~/' + (state.env.platform === 'mac' ? '.zshrc' : '.bashrc') + '（重新登录后全局生效；本会话已立即启用）',
    }
  }

  // ================= 网络代理（git 直连超时时的自愈：读系统代理并写入 git 配置） =================
  function gitConfigArgs(scope) {
    return scope === 'global' ? ['--global'] : ['--local']
  }

  async function netStatus() {
    await ensureEnv()
    const httpR = await runArgv(['git', 'config', '--get', 'http.proxy'], { timeoutMs: 15000 })
    const httpsR = await runArgv(['git', 'config', '--get', 'https.proxy'], { timeoutMs: 15000 })
    let systemProxy = null
    if (state.env.platform === 'windows') {
      try {
        const en = await runArgv(['cmd', '/c', 'reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'], { timeoutMs: 15000 })
        const sv = await runArgv(['cmd', '/c', 'reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'], { timeoutMs: 15000 })
        let enabled = false
        if (en.exitCode === 0) {
          const em = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(en.stdout || '')
          if (em) enabled = parseInt(em[1], 16) !== 0
        }
        if (enabled && sv.exitCode === 0) {
          const sm = /REG_SZ\s+(.+)$/m.exec(sv.stdout || '')
          if (sm) systemProxy = sm[1].trim()
        }
      } catch (e) {
        systemProxy = null
      }
    }
    return {
      ok: true,
      platform: state.env.platform,
      gitHttpProxy: httpR.exitCode === 0 ? (httpR.stdout || '').trim() : '',
      gitHttpsProxy: httpsR.exitCode === 0 ? (httpsR.stdout || '').trim() : '',
      systemProxy,
    }
  }

  async function netSetProxy(proxy, scope) {
    const p = String(proxy || '').trim()
    if (!p) return { ok: false, error: '请输入代理地址，如 http://127.0.0.1:7897' }
    const args = gitConfigArgs(scope)
    const a = await runArgv(['git', 'config'].concat(args, ['http.proxy', p]), { timeoutMs: 15000 })
    const b = await runArgv(['git', 'config'].concat(args, ['https.proxy', p]), { timeoutMs: 15000 })
    if (a.exitCode !== 0 || b.exitCode !== 0) {
      return { ok: false, error: ((a.stderr || '') + (b.stderr || '')).trim() || '写入 git 代理配置失败' }
    }
    return { ok: true, message: '已设置 git 代理（' + (scope === 'global' ? '全局' : '当前仓库') + '）：' + p }
  }

  async function netAutoProxy(scope) {
    const s = await netStatus()
    if (!s.systemProxy) {
      return state.env.platform === 'windows'
        ? { ok: false, error: '未检测到 Windows 系统代理（注册表 ProxyEnable/ProxyServer），请手动输入代理地址。' }
        : { ok: false, error: '当前平台未内置系统代理检测，请手动输入代理地址（如 http://127.0.0.1:7897）。' }
    }
    return netSetProxy(s.systemProxy, scope)
  }

  async function netClearProxy(scope) {
    const args = gitConfigArgs(scope)
    await runArgv(['git', 'config'].concat(args, ['--unset-all', 'http.proxy']), { timeoutMs: 15000 })
    await runArgv(['git', 'config'].concat(args, ['--unset-all', 'https.proxy']), { timeoutMs: 15000 })
    return { ok: true, message: '已清除 git 代理配置（' + (scope === 'global' ? '全局' : '当前仓库') + '）。若网络受限，git 操作可能直连超时。' }
  }

  async function netTestProxy() {
    // 使用当前 git 配置（含代理）连通测试 GitHub
    const r = await runArgv(['git', 'ls-remote', 'https://github.com/cli/cli.git', 'HEAD'], { timeoutMs: 45000 })
    if (r.exitCode === 0) return { ok: true, message: '连接 GitHub 成功（当前 git 代理配置可用）' }
    const err = (r.stderr || '').trim() || '连接 GitHub 失败'
    const hint = /timed out|Connection timed|Failed to connect|Recv failure|Could not|无法连接|超时/i.test(err)
      ? '（直连超时/被中断，通常是网络受限，建议配置代理）'
      : ''
    return { ok: false, error: err + hint }
  }

  // ================= routes（Client -> Host RPC，标准 webServer 路由） =================
  function missingSub() {
    return sub == null || timerSvc == null
  }

  const API_PREFIX = '/api/dsh-ghcli/'
  const MAX_JSON_BODY_BYTES = 1024 * 1024

  /** Loopback literal check plus browser same-origin markers（与 dsh-ssh 同款防护）。 */
  function isLoopbackRequest(req) {
    const address = req.socket && req.socket.remoteAddress
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
    const host = req.headers.host
    if (typeof host !== 'string') return false
    let hostUrl
    try {
      hostUrl = new URL('http://' + host)
    } catch {
      return false
    }
    if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = req.headers.origin
    if (origin === undefined) return true
    try {
      return new URL(origin).host === hostUrl.host
    } catch {
      return false
    }
  }

  /** One JSON response. */
  function writeJson(res, status, body) {
    const payload = JSON.stringify(body)
    try {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
      res.end(payload)
    } catch (e) { /* client gone */ }
  }

  /** Read a JSON request body（undefined when too large or unparseable）。 */
  async function readJsonBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_JSON_BODY_BYTES) return undefined
      chunks.push(buffer)
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      return typeof parsed === 'object' && parsed !== null ? parsed : undefined
    } catch {
      return undefined
    }
  }

  /** 把方法名映射为一条 POST JSON 路由，handler 签名 (args) => result（与旧 harness.handle 同契约）。 */
  function jsonRoute(method, fn) {
    return {
      kind: 'exact',
      path: API_PREFIX + method,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
        if ((req.method || 'GET') !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const body = await readJsonBody(req)
        if (body === undefined) return writeJson(res, 400, { ok: false, error: 'invalid JSON body' })
        try {
          const result = await fn(body)
          writeJson(res, 200, result)
        } catch (e) {
          writeJson(res, 200, { ok: false, error: String((e && e.message) || e) })
        }
      },
    }
  }

  const routes = [
    jsonRoute('gh.status', async () => {
      try {
        if (missingSub()) return { ok: false, error: 'subprocess/timer 服务不可用' }
        const env = await ensureEnv()
        const d = await detectGh(true) // 强制重检：用户安装/加 PATH 后「重新检测」立即可见
        const installers = await detectInstallers()
        let ghHost = null
        if (d.installed) {
          const h = await runArgv(ghArgv('config', 'get', 'host'), { timeoutMs: 15000 })
          ghHost = h.exitCode === 0 ? (h.stdout || '').trim() : 'github.com'
        }
        let auth = null
        if (d.installed) {
          const a = await authStatus()
          auth = a.ok ? { accounts: a.accounts, active: a.active } : { error: a.error }
        }
        const git = { name: await gitConfigGet('user.name'), email: await gitConfigGet('user.email') }
        return { ok: true, installed: d.installed, version: d.version, path: d.path, pathSource: d.pathSource || null, manualPath: state.manualPath, ghHost, platform: env.platform, home: env.home, installers, auth, git }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.install', async (args) => {
      try {
        return await installGh(String((args && args.opId) || ''))
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.setPath', async (args) => {
      try {
        return await setManualPath(String(args.path || ''))
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.addPath', async (args) => {
      try {
        return await addToPath(String(args.dir || ''))
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.net.status', async () => {
      try {
        return await netStatus()
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.net.set', async (args) => {
      try {
        return await netSetProxy(String(args.proxy || ''), args.scope === 'global' ? 'global' : 'repo')
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.net.auto', async (args) => {
      try {
        return await netAutoProxy(args.scope === 'global' ? 'global' : 'repo')
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.net.clear', async (args) => {
      try {
        return await netClearProxy(args.scope === 'global' ? 'global' : 'repo')
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.net.test', async () => {
      try {
        return await netTestProxy()
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.auth.login', async (args) => {
      try {
        return await authLogin(args || {})
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.auth.switch', async (args) => {
      try {
        return await authSwitch(args || {})
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.auth.logout', async (args) => {
      try {
        return await authLogout(args || {})
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.auth.refresh', async (args) => {
      try {
        return await authRefresh(args || {})
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.git.save', async (args) => {
      try {
        const name = String(args.name || '').trim()
        const email = String(args.email || '').trim()
        const out = []
        const rn = await gitConfigSet('user.name', name)
        if (!rn.ok) out.push('name: ' + rn.message)
        const re = await gitConfigSet('user.email', email)
        if (!re.ok) out.push('email: ' + re.message)
        return out.length ? { ok: false, error: out.join('；') } : { ok: true, message: 'Git 全局配置已保存' }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.current', async (args) => {
      try {
        return await repoCurrent(String(args.workdir || '').trim() || undefined)
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.clone', async (args) => {
      try {
        return await repoClone(args || {})
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.status', async (args) => {
      try {
        return await repoStatus(String(args.repo || '').trim())
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.fork', async (args) => {
      try {
        return await repoFork(args || {})
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.create', async (args) => {
      try {
        return await repoCreate(args || {})
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.open', async (args) => {
      try {
        return await repoOpenRemote(String(args.workdir || '').trim() || undefined)
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.push', async (args) => {
      try {
        return await repoPush(String(args.workdir || '').trim() || undefined)
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.pull', async (args) => {
      try {
        return await repoPull(String(args.workdir || '').trim() || undefined)
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.repo.pr', async (args) => {
      try {
        return await repoPrCreate(String(args.workdir || '').trim() || undefined)
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),

    jsonRoute('gh.op.cancel', async (args) => {
      try {
        const op = state.activeOps.get(String(args.opId || ''))
        if (!op) return { ok: false, error: '操作不存在或已完成' }
        op.terminate()
        return { ok: true, message: '已发送取消请求' }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }),
  ]

  // 注册路由（webServer 服务必须存在）
  const server = ctx.get('webServer')
  if (server === undefined) {
    console.error('dsh-ghcli: webServer 服务不可用，跳过 /api/dsh-ghcli 路由注册')
  } else {
    const disposers = routes.map((route) => server.register(route))
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'dsh-ghcli: routes')
  }

  // Agent 通告（systemPrompt 服务可选，缺失时静默）
  const promptSvc = ctx.get('systemPrompt')
  if (promptSvc) {
    promptSvc.section({ name: 'plugin:dsh-ghcli', order: 150, text: GHLI_GUIDANCE })
  }

  // P0：apply 钩子触发 gh --version 预热检测（与旧动态版一致）
  Promise.resolve().then(async () => {
    try {
      if (!missingSub()) await detectGh()
    } catch (e) {
      state.lastDetect = { installed: false, error: String((e && e.message) || e) }
    }
  })
}
