# Pi Studio

[English](./README.en.md)

**Pi Studio** 是 [Pi Web](https://github.com/agegr/pi-web) 的增强版 fork —— [pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面。它保留了 Pi Web 的全部能力：会话浏览、实时对话、模型配置、技能管理和项目文件预览，并在其上新增了一批提升效率的功能。

![Pi Web 以结构化 Markdown、工具调用和项目导航展示同一个 pi 会话](https://raw.githubusercontent.com/SpikeJulia/pi-studio/master/docs/screenshot2.png)

CLI 和 Pi Studio 中的同一个 pi 会话：结构化的工具调用、可读的 Markdown、会话浏览和更清爽的结果。

## Pi Studio 新增功能

以下都是在原版 Pi Web 基础上新增的：

- **Explorer 右键菜单**：在文件树里右键任意文件或文件夹，可在右侧面板打开，或直接在系统文件管理器中显示。
- **文件夹标签页**：文件夹以带面包屑导航的标签页形式浏览；点击里面的文件即可作为独立标签页打开。
- **面板内网址预览**：聊天里的 http(s) 链接在沙箱化的面板内预览，不再把你拽去新标签页。
- **智能嵌入检测**：拒绝 iframe 嵌入的网站（GitHub、npmjs 等）会清晰提示"在浏览器中打开"，而不是显示空白；允许嵌入的网站（百度、文档站、博客）直接预览。
- **聊天链接一等公民**：指向本地文件、文件夹和网址的 Markdown 链接全部路由到右侧面板。
- **附件上传**：把文件或图片拖进聊天即可上传到项目，agent 可以按路径读取或引用它们。
- **自定义头像**：为不同角色设置你自己的图片头像。

## 核心功能

继承自 Pi Web，依然可用：

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息重新开始，也可以复制出一条独立的新路线，探索方案时不怕弄乱原来的对话。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；文件变化会自动刷新，适合边让 agent 改边检查结果。
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理，配置 agent 时不用在多个工具之间来回切换。

## 快速开始

**无需安装，直接运行：**

```bash
npx @spikejulia/pi-studio@latest
```

**或全局安装后使用：**

```bash
npm install -g @spikejulia/pi-studio
pi-web
```

启动后打开 [http://localhost:30141](http://localhost:30141)。命令行版本会在服务就绪后尝试自动打开浏览器。

**可选参数：**

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 127.0.0.1     # 仅本机访问
pi-web -p 8080 -H 127.0.0.1     # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启
```

## HTTP 代理

Pi Studio 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @spikejulia/pi-studio@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @spikejulia/pi-studio@latest
```

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [Pi Studio 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://localhost:30141](http://localhost:30141)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server。发布流程再执行构建。

## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # skills 列表、搜索、安装、启停
    system/open/    # 在系统文件管理器中打开路径
    url/check/      # 检查网址是否允许 iframe 内嵌预览
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # 项目选择、会话树、Explorer
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树（含右键菜单）
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX、文件夹、URL 预览
lib/
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理配置
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-links.ts       # Markdown 链接解析与 URL 分类
  file-paths.ts       # 文件路径编码/相对路径工具
  url-embed.ts        # 判断网址是否允许 iframe 嵌入
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
bin/
  pi-web.js           # npm CLI 入口
instrumentation.ts    # 初始化服务端 HTTP dispatcher
```
