# Chronicle Calendar Database Package

## 这是什么

这是 Chronicle Calendar 的独立 `database package`。

它的目标不是单纯存一份 SQLite 文件，而是把下面这些内容打包在同一个目录里：

- 数据本体
- schema
- 迁移脚本
- 操作规则
- 对外工具接口说明
- 给 LLM / agent 看的使用入口

你可以把这个目录理解成：

`秘书手里的一本笔记本`

任何人或任何 agent 拿到这个目录后，都应该能快速知道：

- 这份 database 是干什么的
- 数据按什么结构保存
- 可以怎么查
- 可以怎么改
- 修改时要遵守什么规则

---

## 这个目录怎么用

### 用法 1：接入桌面端 / UI

如果有 UI 或桌面端壳：

- UI 负责展示和编辑
- database package 负责提供数据结构与规则
- AI 助手通过这里定义的接口访问 database

也就是说：

`UI 是界面，database package 是本体`

### 用法 2：直接交给 agent / vibe coding 工具

如果没有 UI，只把这个目录给 Codex 这类 agent：

- 先读本文件
- 再读 `SECRETARY_README.md`
- 再读 `DATABASE_OVERVIEW.md`
- 再读 `TOOLS.md`
- 再读 `OPERATIONS.md`
- 最后按 `migrations/` 和实际数据库文件工作

这样 agent 就能直接理解这份 database 的规则，并对它进行查询、维护或接入新的软件壳。

---

## 当前目录结构

```txt
database/
  README.md
  SECRETARY_README.md
  DATABASE_OVERVIEW.md
  TOOLS.md
  OPERATIONS.md
  meta.json
  data/
    README.md
  migrations/
    0001_init.sql
  examples/
    assistant-usage.md
```

---

## 重要文件说明

### `SECRETARY_README.md`

给 LLM / secretary / agent 看的最短入口文档。

### `DATABASE_OVERVIEW.md`

讲 database 的内部层次和设计哲学。

### `TOOLS.md`

讲 database 对外提供的通用能力接口。

### `OPERATIONS.md`

讲允许什么操作、不允许什么操作、修改时要保留什么痕迹。

### `migrations/0001_init.sql`

当前 v3 的正式 SQLite schema 起点。

### `data/`

放 database 真正的数据文件或导出文件。

当前桌面端 SQLite 逻辑路径已经固定为：

`database/data/chronicle-calendar.db`

注意：

- 这是 database package 内部的标准相对路径
- 在 Tauri 桌面端里，它会映射到应用数据目录下的对应位置
- 不等于当前源码仓库里的物理文件一定会实时出现

---

## 当前项目里的落地状态

当前仓库已经做到：

- 前端状态结构与 SQLite schema 基本对齐
- Tauri 桌面端可接入 SQLite
- secretary 已经有通用工具接口雏形

当前还没完全做到：

- database 读写代码还没有完全从 `src/app.js` 拆出
- 运行中的 SQLite 文件路径还没有固定到本目录
- UI / agent / database 之间还没有完全抽成稳定 SDK

所以现在这个 `database/` 目录更像是：

`v3 的正式 database package 规范入口`

它已经足够给人和 agent 使用，也为后续真正物理独立 database 做好了结构准备。
