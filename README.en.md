<div align="center">

[中文](./README.md) · **English**

# 🎨 Pi Studio

#### A local web workbench for the pi coding agent — Pi Web, enhanced

[![License](https://img.shields.io/badge/License-MIT-10B981?style=for-the-badge)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-@spikejulia/pi--studio-CB3837?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spikejulia/pi-studio)
[![Pi](https://img.shields.io/badge/Pi-Coding_Agent-2563EB?style=for-the-badge)](https://github.com/badlogic/pi-mono)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)

</div>

A fork of [Pi Web](https://github.com/agegr/pi-web) that I've been running in my own projects — added a few genuinely time-saving features, then cleaned it up for open source.

Not a reskin: it connects the file tree, chat, and preview into one flow — **right-click to open, click a link to see it**.

---

## 📋 Table of Contents

| Name | One-liner |
|---|---|
| 🖱️ [**Right-click menu**](#-right-click-menu) | Open / reveal in system file manager, right from the tree |
| 📁 [**Folder tabs**](#-folder-tabs) | Folders open as tabs with breadcrumb navigation |
| 🔗 [**In-panel URL preview**](#-in-panel-url-preview) | Chat links preview in the side panel; refuse-embedding sites get a hint |
| 📎 [**File uploads**](#-file-uploads) | Drag files/images into chat; the agent reads them by path |
| 🧑‍🎨 [**Custom avatars**](#-custom-avatars) | Per-role avatars from your own images |

---

## ✨ New Features

### 🖱️ Right-click menu

> *"Stop ls-ing in the terminal to find files."*

Right-click any file or folder in the Explorer:

- **Open** — files open a preview tab, folders open a browse tab
- **Show in system file manager** — reveal it in your OS file manager

### 📁 Folder tabs

> *"Opening a directory should feel as natural as opening a file."*

- Folders open as their own tabs with breadcrumb navigation
- Click a file → open its tab; click a subdirectory → navigate into it

### 🔗 In-panel URL preview

> *"A GitHub link shouldn't yank you to a new tab — embed when possible, say so when not."*

- http(s) links in chat open in a sandboxed in-panel iframe
- Automatically detects whether a site allows embedding (`X-Frame-Options` / `CSP frame-ancestors`)
- Sites that refuse (GitHub, npmjs...) show a hint + "Open in browser" button; sites that allow it (Baidu, docs, blogs) preview directly
- Ctrl/Cmd+click still opens a new browser tab

### 📎 File uploads

- Drag files/images into chat, uploaded to the project directory
- The agent can read and reference them by path

### 🧑‍🎨 Custom avatars

- Set your own image avatars for user / assistant / tool roles

---

## 🚀 Quick Start

**Run without installing:**

```bash
npx @spikejulia/pi-studio@latest
```

**Or install globally:**

```bash
npm install -g @spikejulia/pi-studio
pi-studio
```

Then open [http://localhost:30141](http://localhost:30141).

**Common options:**

```bash
pi-studio --port 8080              # custom port
pi-studio --hostname 127.0.0.1     # local access only
pi-studio --no-open                # do not auto-open the browser
```

> Honors `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` env vars (server-side model/API requests).

---

## 📦 Installation

**From npm (recommended):**

```bash
npm install -g @spikejulia/pi-studio
```

**From source:**

```bash
git clone https://github.com/SpikeJulia/pi-studio.git
cd pi-studio
npm install
npm run dev        # dev mode (hot reload)
npm run build && npm start   # production mode
```

---

## 💡 Core Capabilities (inherited from Pi Web)

- **Session browsing**: revisit past pi conversations by project, no terminal archaeology
- **Safe branching**: continue from any message or fork into an independent route
- **Cross-branch work**: switch Git worktrees in the sidebar; Explorer follows the checkout
- **File preview**: source, diff, images, audio, PDF, DOCX — all in the right panel
- **Visible session state**: context usage, cost, compaction, system prompt at a glance
- **Less context switching**: models, login/API keys, skill toggles all in the web UI

---

## 📄 License

MIT © SpikeJulia
