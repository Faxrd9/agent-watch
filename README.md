# Agent Watch

一个本地、只读、零第三方运行时依赖的 Codex / Claude Code 活动监控面板。

它解决一个很具体的问题：当 AI 编程代理长时间没有回复时，你可以看到它是仍有本地活动、正在调用工具、等待模型/网络，还是已经进入“请求未完成且长期没有心跳”的疑似卡住状态。

> Agent Watch 不是网络抓包器。它展示的是本机会话日志和进程中**可观察到的活动**，不能证明 OpenAI 或 Anthropic 云端实际收到的完整 TLS 请求内容。

## 功能

- 同时检测 Codex 与 Claude Code 是否运行
- 结合进程 CPU 变化、会话 JSONL 更新和未完成请求判断状态
- 在 Windows 上辅助观察 Codex / Claude Code 进程的 TCP 连接状态（不读取传输内容）
- 区分：正在活动、等待模型/工具、疑似卡住、可能有网络问题、空闲、未运行
- 展示工具调用、工具输出、文件路径、附件事件、用户输入和代理输出
- 默认隐藏正文；可临时开启“脱敏正文预览”
- 自动隐藏用户主目录、API key、Bearer token、私钥等敏感内容
- 一键导出不含正文预览的脱敏诊断 JSON
- Edge / Chrome 画中画始终置顶状态窗，并提供普通独立小窗回退
- 按条数与时间自动淘汰内存记录，并可手动清空界面；不会删除原始会话文件
- 仅监听 `127.0.0.1`，无遥测、无外部网络请求
- Windows 优先，同时提供 macOS / Linux 的基础进程探测

## 快速开始

要求：Node.js 20 或更高版本。

Windows：

1. 双击 `start.cmd`
2. 浏览器会自动打开 `http://127.0.0.1:4317`
3. 保持命令窗口打开；关闭窗口即可停止软件

点击顶部“小窗模式”可打开精简状态窗。支持 Document Picture-in-Picture 的 Edge/Chrome 会始终置顶；不支持时会打开普通弹出窗口。小窗会根据宽度和高度自动缩放、换行，并在空间极小时优先保留代理名称与状态。独占全屏游戏可能覆盖系统画中画窗口，无边框窗口或窗口化模式通常可以正常显示。

命令行：

```bash
npm start
```

不自动打开浏览器：

```bash
npm run start:no-open
```

自定义端口：

```bash
node src/server.js --open --port=5000
```

## 它读取什么

默认只读以下本地路径：

| 产品 | 数据源 | 用途 |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/*.jsonl` | 会话、工具、文件与输出事件 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | 会话、思考、工具、附件与输出事件 |
| Claude Code | `~/.claude/sessions/*.json` | `busy` 等本地会话状态 |
| 两者 | 本机进程列表 | PID、累计 CPU、内存和存活状态 |

Agent Watch 对不同的不可见内容使用明确文案：

- **内容已加密，无法读取**：例如 Codex 的 `encrypted_content`，本地没有解密密钥。
- **为保护隐私主动未读取**：字段可能存在，但软件选择不解析，例如最近一次提示正文或系统通知正文。
- **可见推理摘要**：供应商主动写入日志的摘要，可以脱敏展示，但它不等于完整思维链。

Agent Watch 不尝试展示私有思维链，也不读取浏览器 Cookie、认证文件或环境变量。

## 状态判断

“卡住”只能是有证据的推断，不能被软件百分之百确认。

- **正在活动**：最近 8 秒内会话日志有更新，或进程累计 CPU 有变化
- **等待模型 / 工具**：会话仍有未完成请求，但暂时没有新本地事件
- **TCP 已连接，等待数据**：请求未完成、连接仍存在，但暂时没有新的会话流事件
- **工具运行中**：本地或 MCP 工具调用尚未返回；不会把它算作模型网络故障
- **工具可能卡住**：工具调用超过阈值且没有工具输出或 CPU 心跳，与“模型网络问题”分开显示
- **疑似卡住**：请求仍未完成，超过设置阈值后会话日志和 CPU 都没有心跳
- **可能有网络问题**：近期可观察事件包含超时、连接失败、重试、限流等信号
- **空闲**：进程存在，但没有待处理请求
- **未运行**：没有发现对应进程

默认疑似卡住阈值是 120 秒，可在界面中调整。界面记录默认最多保留 200 条和 60 分钟，任一条件超出都会淘汰最旧记录。

网络问题只根据 Codex / Claude Code 的结构化 API 错误、连接失败、重试或限流事件判断。聊天正文或工具输出中普通提到“网络”“timeout”“429”等词不会触发网络告警。

### 为什么不能精确区分“模型在思考”和“网络半开”？

当远端还没有返回任何流式事件时，这两种情况对本地观察者可能完全相同。Agent Watch 会如实显示“等待模型 / 工具，暂无新本地心跳”，而不是伪装成精确判断。

## “上传了什么”的准确含义

Agent Watch 可以显示：

- 会话日志记录的输入与附件事件
- 代理读取、搜索、修改或创建的文件路径
- shell / MCP / 内置工具的名称、参数摘要和返回摘要
- Codex / Claude Code 输出到本地会话的回复

Agent Watch 不能可靠显示：

- HTTPS 加密连接中最终发送的精确字节
- 服务端在请求到达后追加或转换的内部上下文
- Codex 的加密推理内容或供应商未写入本地日志的数据

项目有意不实现 MITM 代理或证书注入，因为这会扩大认证信息泄露和供应链风险。

## 隐私模型

- 原始 JSONL 只在内存中增量解析
- 初次发现会话时最多读取文件尾部 256 KiB
- 不创建会话内容数据库
- 默认不把正文预览发给浏览器
- 即使开启预览，也会先脱敏并截断
- 导出诊断会再次移除所有正文预览
- Web 服务只绑定到回环地址，不接受局域网连接

更多信息见 [PRIVACY.md](PRIVACY.md) 与 [SECURITY.md](SECURITY.md)。

## 项目结构

```text
agent-watch/
├─ public/              # 本地仪表盘
├─ src/
│  ├─ discovery.js      # 会话发现与 JSONL 增量读取
│  ├─ parsers.js        # Codex / Claude Code 事件适配
│  ├─ process-probe.js  # Windows / POSIX 进程心跳
│  ├─ redact.js         # 路径和密钥脱敏
│  ├─ state.js          # 状态机
│  ├─ monitor.js        # 数据汇总
│  └─ server.js         # 仅本机 HTTP + SSE 服务
```

## 开发

```bash
npm run check
npm run start:no-open
```

项目运行时不需要 `npm install`，因为没有第三方依赖。

## 已知兼容性限制

Codex 与 Claude Code 的本地会话 JSONL 属于版本相关接口，未来版本可能调整字段。解析器会忽略未知事件，避免因单条格式变化导致监控停止。提交兼容性问题时，请使用界面的“导出脱敏诊断”，不要上传原始会话文件。

当前开发时验证的版本：

- Codex CLI `0.144.1`
- Claude Code `2.1.168`

## 上传到 GitHub

项目不会把监控事件写入仓库，也不使用 Cookie、`localStorage` 或 IndexedDB 保存会话内容。请不要手动把原始 `.jsonl`、数据库、截图或诊断导出复制进项目目录；常见日志、数据库、`.env` 和诊断文件已由 `.gitignore` 排除。

在 `agent-watch` 目录中执行：

```bash
git init
git add .
git commit -m "Initial open source release"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/agent-watch.git
git push -u origin main
```

## 路线图

- 可选的 Codex `exec --json` / Claude `stream-json` 启动器，获得更实时的事件
- 可选 hooks 收集器，用语义事件区分权限等待、工具完成与 API 重试
- Windows 单文件可执行版本
- 系统托盘与桌面通知
- 更多版本兼容性 fixture

## 贡献

欢迎提交 issue 和 pull request。请勿把真实会话 JSONL、token、用户名路径或未脱敏诊断加入 issue。

## 许可证

[MIT](LICENSE)
