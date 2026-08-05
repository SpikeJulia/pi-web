<div align="center">

**中文** · [English](./README.en.md)

# 🎨 Pi Studio

#### 基于 pi coding agent 的本地网页工作台 —— 增强版 Pi Web

[![License](https://img.shields.io/badge/License-MIT-10B981?style=for-the-badge)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-@spikejulia/pi--studio-CB3837?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spikejulia/pi-studio)
[![Pi](https://img.shields.io/badge/Pi-Coding_Agent-2563EB?style=for-the-badge)](https://github.com/badlogic/pi-mono)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)

</div>

Fork 自 [Pi Web](https://github.com/agegr/pi-web)，在自己项目里跑了一段时间，加了几样确实省事的东西，才整理出来。

把"文件树、聊天、预览"这三件事打通——**右键就能打开，链接点了就能看**。

---

## 📋 目录

| 名字 | 一句话 |
|---|---|
| 🖱️ [**右键菜单**](#-右键菜单) | 文件树里右键：打开 / 系统文件管理器显示 |
| 📁 [**文件夹标签页**](#-文件夹标签页) | 文件夹像文件一样开标签页，带面包屑浏览 |
| 🔗 [**网址内嵌预览**](#-网址内嵌预览) | 聊天里的链接直接在右侧面板看，拒绝嵌入的给提示 |
| 📎 [**附件上传**](#-附件上传) | 拖文件/图片进聊天，agent 按路径读取 |
| 🧑🎨 [**自定义头像**](#-自定义头像) | 每个角色用自己的图片 |

---

## ✨ 新特性

### 🖱️ 右键菜单

> *"找文件、看文件，别总在终端里 ls。"*

Explorer 里右键任意文件或文件夹：

- **打开** —— 文件开预览标签页，文件夹开浏览标签页
- **在系统文件管理器中显示** —— 直接弹系统资源管理器并定位

### 📁 文件夹标签页

> *"点开一个目录，跟点开一个文件一样自然。"*

- 文件夹作为独立标签页打开，右侧面包屑导航
- 点文件 → 开文件标签页；点子目录 → 进入

### 🔗 网址内嵌预览

> *"GitHub 链接不该把我拽去新标签页——能嵌就嵌，不能嵌就明说。"*

- 聊天里的 http(s) 链接 → 右侧沙箱 iframe 预览
- 自动检测网站是否允许嵌入（读 `X-Frame-Options` / `CSP frame-ancestors`）
- 拒绝嵌入的网站（GitHub、npmjs...）显示提示 + "在浏览器中打开"按钮；允许的（百度、文档站...）直接预览
- Ctrl/Cmd+点击仍走浏览器新标签

### 📎 附件上传

- 拖文件/图片进聊天，上传到项目目录
- agent 可以按路径读取、引用上传的文件

### 🧑🎨 自定义头像

- 为 user / assistant / tool 各角色设置你自己的图片头像

---

## 🚀 快速开始

**免安装直接跑：**

```bash
npx @spikejulia/pi-studio@latest
```

**或全局安装：**

```bash
npm install -g @spikejulia/pi-studio
pi-studio
```

启动后打开 [http://localhost:30141](http://localhost:30141)。

**常用参数：**

```bash
pi-studio --port 8080              # 自定义端口
pi-studio --hostname 127.0.0.1     # 仅本机访问
pi-studio --no-open                # 不自动打开浏览器
```

> 支持 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境变量（服务端模型/API 请求）。

---

## 📦 安装方式

**从 npm 装（推荐）：**

```bash
npm install -g @spikejulia/pi-studio
```

**从源码跑：**

```bash
git clone https://github.com/SpikeJulia/pi-studio.git
cd pi-studio
npm install
npm run dev        # 开发模式（热重载）
npm run build && npm start   # 生产模式
```

---

## 💡 核心能力（继承自 Pi Web）

- **会话回看**：按项目浏览历史 pi 对话，不用翻终端记录
- **安全分支**：从任意消息继续 / fork 出独立路线
- **跨分支工作**：侧边栏切换 Git worktree，Explorer 跟随 checkout
- **文件预览**：源码、diff、图片、音频、PDF、DOCX 全在右侧
- **会话状态透明**：上下文占用、花费、压缩状态、系统提示一目了然
- **少离开界面**：模型、登录/API key、技能开关全在网页里

---

## 📄 许可证

MIT © SpikeJulia
