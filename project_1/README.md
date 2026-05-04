# 个人知识库 / 笔记助手

一个 Obsidian 风格的本地知识库桌面应用，支持 Markdown 笔记、双链、知识图谱、AI 速记和局域网分享。

## 项目结构

```
├── note-app/                    # 最终桌面端主项目 (Electron + React + Vite + TypeScript)
├── 个人知识库-笔记助手/          # 项目笔记和需求文档
└── 个人知识库-笔记助手-app/     # 早期 Web 原型 (已弃用)
```

## 快速开始

```bash
cd note-app
npm install
npm run electron:dev
```

## 打包

```bash
cd note-app
npm run electron:package
```

打包产物输出到 `note-app/dist-desktop/`：
- `个人知识库 Setup 1.0.0.exe` (安装版)
- `个人知识库-便携版.exe` (便携版)

## 功能

- Markdown 笔记创建、编辑、删除
- `[[双链]]` 支持
- 知识图谱
- 标签管理与筛选
- 全文搜索
- 命令面板 / 快速切换
- 速记和链接速记
- 导出和局域网分享
- 纯本地运行，默认离线
