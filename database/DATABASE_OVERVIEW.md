# Database Overview

## 一句话定义

Chronicle Calendar 的 `database` 是一个：

`可独立迁移、可被 UI 接入、可被 agent 阅读和操作的本地日程数据包`

---

## 核心目标

database 的职责不是扮演 AI，而是长期稳定地保存和组织你的时间相关信息。

它要做到：

- 能被桌面端 UI 接入
- 能被 secretary / agent 读取和操作
- 能保留原始输入
- 能保留结构化结果
- 能支持检索
- 能支持追溯

---

## 内部分层

### 1. Raw Input Layer

对应：`raw_inputs`

职责：

- 永久保留用户原始输入
- 记录输入来源和解析状态

意义：

- 原始真相不可丢
- 未来可以重新解析

### 2. Structured Record Layer

对应：`records`

职责：

- 保存正式结构化记录

当前主要类型：

- `calendar`
- `task`
- `memory`

意义：

- 给 UI 展示和编辑
- 给 secretary 提供标准化读写对象

### 3. Search Layer

对应：`search_docs`

职责：

- 保存适合检索的压缩文本与辅助字段

意义：

- 提供候选召回层
- 为未来 FTS / embedding / rerank 留接口

### 4. Trace Layer

对应：`trace_logs`

职责：

- 保存快照
- 保存字段变更

意义：

- 支持回溯
- 支持解释“为什么现在会是这样”

### 5. Draft Layer

对应：`drafts`

职责：

- 保存待确认的候选新增项

意义：

- 不把不确定理解直接写成正式事实

### 6. Auxiliary Layer

包括：

- `tags`
- `attachments`
- `chat_messages`
- `settings`

作用：

- 管理标签
- 管理附件与证据材料
- 保留秘书对话历史
- 保存模型接入配置

---

## 设计边界

database 应负责：

- 数据保存
- 数据检索
- 数据追溯
- 通用接口能力

database 不应负责：

- 理解自然语言
- 猜用户真正意图
- 决定本轮该不该调用工具
- 充当聊天机器人

这些职责属于 secretary / agent。

---

## 为什么要把它做成独立目录

因为这能带来三个重要好处：

1. 可迁移  
整个目录拷到另一台电脑，仍然成立。

2. 可替换  
可以换 UI，换 AI，换桌面壳，而 database 仍然不变。

3. 可协作  
人、程序、agent 都可以阅读同一套规则，而不是靠口头约定。
