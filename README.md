# 📚 个人知识库 / 笔记助手

> 一个 **Obsidian 风格** 的本地知识库桌面应用：
> 支持 Markdown、双链、知识图谱、速记与局域网分享，默认离线、数据留在本机。

---

## ✨ 项目亮点

- 📝 **Markdown 笔记**：快速创建、编辑与管理结构化笔记
- 🔗 **双链支持**：使用 `[[笔记标题]]` 连接知识点
- 🕸️ **知识图谱**：可视化展示笔记间关系
- 🏷️ **标签系统**：按标签聚合与筛选内容
- 🔎 **全文搜索**：快速定位目标笔记
- ⚡ **效率工具**：命令面板、快速切换、速记入口
- 📦 **导出与分享**：支持导出、局域网共享
- 🔒 **本地优先**：纯本地运行，默认离线

---

## 🧱 技术栈

- **桌面端**：Electron
- **前端**：React 19 + TypeScript
- **构建工具**：Vite
- **测试**：Vitest
- **代码质量**：ESLint

---

## 📁 目录结构

```text
.
├── note-app/                   # 主项目（Electron + React + Vite + TypeScript）
└── 个人知识库-笔记助手/         # 项目笔记与需求文档
```

---

## 🚀 快速开始

```bash
cd note-app
npm install
npm run electron:dev
```

---

## 🛠️ 常用命令

```bash
cd note-app
npm run dev            # Web 开发模式
npm run electron:dev   # 桌面端开发模式
npm run test           # 单元测试
npm run lint           # 代码检查
npm run typecheck      # 类型检查
npm run build          # 构建前端
npm run electron:package  # 打包桌面应用
```

---

## 📦 打包输出

执行：

```bash
cd note-app
npm run electron:package
```

产物目录：`note-app/dist-desktop/`

- `个人知识库 Setup 1.0.0.exe`（安装版）
- `个人知识库-便携版.exe`（便携版）

---

## 🎯 适用场景

- 个人知识管理（PKM）
- 读书笔记与学习沉淀
- 项目文档与灵感收集
- 本地离线知识资产管理

---

## 🤝 贡献

欢迎提交 Issue / PR 来改进体验与功能。

如果你在使用中发现问题，也欢迎附上复现步骤与截图，方便快速定位。
