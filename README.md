# Chronicle Calendar

这是一个本地优先的时间管理原型。`v3` 继续收敛后，项目的核心架构已经明确分成三层：

- `database package`：独立的日程数据能力层，负责原始保存、结构化记录、检索与追溯
- `AI secretary`：独立的智能秘书层，负责理解自然语言、决定是否调用 database 工具、组织最终回答
- `UI shell`：软件界面或网页界面，负责可视化编辑、展示与交互

当前重点验证四件事：

- 月视图与周视图的日历管理
- 待办事项与日程共存
- 统一 AI 对话框作为“秘书入口”调用数据库工具
- 原始输入、检索层、追溯层的可追溯存储

## 新线程接手前先看

如果你准备在 Codex 中切换线程、分工作树或让新的线程接手，请优先阅读：

1. [docs/README.md](/Users/nacl/Desktop/日程/docs/README.md)
2. [database/README.md](/Users/nacl/Desktop/日程/database/README.md)
3. [docs/project-overview.md](/Users/nacl/Desktop/日程/docs/project-overview.md)
4. [docs/architecture-v3.md](/Users/nacl/Desktop/日程/docs/architecture-v3.md)
5. [database/SECRETARY_README.md](/Users/nacl/Desktop/日程/database/SECRETARY_README.md)

其中：

- `docs/README.md` 是开发者文档总目录
- `database/README.md` 是独立 database package 总入口
- `project-overview.md` 是全局背景
- `architecture-v3.md` 是当前推荐的整体架构
- `database/SECRETARY_README.md` 是秘书可直接阅读的 database 使用入口

文档约定：

- `docs/` 只放给开发者看的架构、状态、设计文档
- `llm-readmes/` 只放兼容旧入口的秘书文档
- `database/` 是可迁移的 database package 本体

## 直接使用

这是一个零依赖静态原型。

### 方法 1

直接双击打开 [index.html](/Users/nacl/Desktop/日程/index.html)。

### 方法 2

如果你本机有 Python，可以在目录 `/Users/nacl/Desktop/日程` 执行：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 现在有哪些页面

### 1. 日视图

- 查看单日时间轴
- 拖拽创建日程
- 浏览全天事项与定时事项
- 快速跳入编辑弹窗

### 2. 月视图

- 浏览整月安排
- 单击某天切换当前日期
- 双击某天卡片，弹出当天详细安排

### 3. 周视图

- 以周为单位展示每天安排
- 每天的未定时/全天事项显示在最上方
- 时间轴按连续区块展示定时事项
- 拖拽即可创建新的时间段

### 4. 待办页

- 存放未明确规定时间的事项
- 支持优先级、完成态和标签
- 待办同样参与后续 AI 检索

## 统一 AI 对话框

左侧只有一个主对话框，但在 `v3` 里它已经不是单纯的“意图分流器”，而是秘书入口。

它仍保留三种人工可选模式：

- `自动判断`
- `添加事项`
- `检索总结`

其中 `自动判断` 的工作方式是：

- 优先让 `LLM secretary` 自己判断是否需要调用 database 工具
- 不需要工具时，像普通大模型一样直接聊天回答
- 需要工具时，再调用 database 提供的通用接口
- 如果模型暂时不可用，再回退到机器人规则流程

### 常见输入

```txt
明天下午2点到4点去105上高数课
周五晚上和组员在图书馆讨论比赛报名
帮我找过去一年里和比赛报名、讲座、志愿服务相关的记录
你觉得我这周安排是不是太满了
```

系统会根据上下文决定：

- 是否只是普通聊天
- 是否应该查询 database
- 是否应该生成待确认草稿

## 模型解析设置

左侧有“模型解析设置”：

- `解析模式`
- `API Base URL`
- `API Key`
- `Model`

当前使用 OpenAI 兼容 `/chat/completions` 接口。

接口地址支持这几种写法：

- `https://api.xxx.com`
- `https://api.xxx.com/v1`
- `https://api.xxx.com/v1/chat/completions`

注意：

- `API Base URL` 填模型服务地址
- `Model` 填模型 ID
- 不要把模型名直接拼进 `API Base URL`

## 数据现在存在哪里

`v3` 现在已经切到“双运行形态”：

- `Tauri 桌面版`：使用本地 `SQLite` 作为真实持久化
- `纯浏览器模式`：不再写 `localStorage`，只保留当前会话内存态

这意味着：

- 桌面版关闭后数据仍会保留
- 浏览器模式刷新后数据会丢失
- 当前真正的长期落点已经是 `Tauri + SQLite`
- 桌面端 SQLite 的标准逻辑路径已固定为 `database/data/chronicle-calendar.db`

当前 `v3` 的主数据结构已经收敛为：

- `records`
- `rawInputs`
- `searchDocs`
- `drafts`
- `traceLogs`
- `attachments`
- `chatMessages`
- `settings`

其中：

- `records` 统一承载 `calendar / task / memory`
- `rawInputs` 永久保留原始输入
- `searchDocs` 是轻量检索层
- `traceLogs` 保存快照与字段变更等追溯信息
- `chatMessages` 保存秘书对话历史
- `settings` 保存模型接入配置

## 导入导出

### 导出

点击左侧 `导出 JSON`，会下载当前全部本地数据。

### 导入

点击左侧 `导入 JSON / ICS`，选择文件后即可恢复或导入。

## 当前仓库里的 v3 骨架

目前仓库已经包含：

- [database/README.md](/Users/nacl/Desktop/日程/database/README.md)
- [database/SECRETARY_README.md](/Users/nacl/Desktop/日程/database/SECRETARY_README.md)
- [database/migrations/0001_init.sql](/Users/nacl/Desktop/日程/database/migrations/0001_init.sql)
- [src/database/store.js](/Users/nacl/Desktop/日程/src/database/store.js)
- [src/database/query.js](/Users/nacl/Desktop/日程/src/database/query.js)
- [src/secretary/assistant.js](/Users/nacl/Desktop/日程/src/secretary/assistant.js)
- [docs/architecture-v3.md](/Users/nacl/Desktop/日程/docs/architecture-v3.md)
- [llm-readmes/secretary-calendar-readme.md](/Users/nacl/Desktop/日程/llm-readmes/secretary-calendar-readme.md)
- [docs/history-v1-v2.md](/Users/nacl/Desktop/日程/docs/history-v1-v2.md)
- `src/app.js` 中的 `records / rawInputs / searchDocs / traceLogs` 本地原型结构
- `src/app.js` 中的秘书工具规划与调用流程
- `src-tauri/` 最小桌面端技术骨架

说明：

- `database/` 现在承担“秘书笔记本式”独立 database package 角色
- `src/database/store.js` 现在承担前端运行时的 database 读写模块
- `src/database/query.js` 现在承担 database 的检索与读取模块
- `src/secretary/assistant.js` 现在承担 AI secretary 的模型与工具编排模块
- `src-tauri/` 已经承担桌面端 SQLite 持久化壳层
- `src/app.js` 正在收敛为 UI shell 接线层
- 浏览器模式现在只作为静态原型预览，不再承担正式持久化
