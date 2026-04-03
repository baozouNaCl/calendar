# Database Tools

## 文档目的

这份文档定义 Chronicle Calendar database 对外暴露的通用能力接口。

重点原则：

- tool 是 database 的能力边界
- 要不要调用、何时调用，由 secretary / agent 决定
- tool 设计要通用，不为某个单一问法硬编码

---

## `search_records`

### 作用

按自然语言语义搜索记录。

### 输入

- `query: string`
- `limit?: number`
- `recordTypes?: string[]`

### 输出

返回一组候选记录，通常应包含：

- record 基本信息
- 相关性或置信度
- 简短原因

### 使用原则

- 重点是“真正相关”
- 不能只因为命中了某个词就算相关
- 应优先找真正满足用户语义条件的记录

---

## `list_records`

### 作用

按时间范围、类型或数量列出记录。

### 输入

- `dateFrom?: string`
- `dateTo?: string`
- `limit?: number`
- `recordTypes?: string[]`

### 输出

返回按规则排序后的记录列表。

### 适用场景

- 这周有什么安排
- 明天有什么事
- 最近有哪些待办

---

## `get_record_detail`

### 作用

读取单条记录的完整上下文。

### 输入

- `recordId: string`

### 输出

除了基础 record 信息外，建议包括：

- 原始输入
- 追溯记录
- 相关附件

### 适用场景

- 用户追问某条事项细节
- secretary 需要更完整上下文后再回答

---

## `create_drafts_from_text`

### 作用

把自然语言输入转换成待确认草稿。

### 输入

- `text: string`

### 输出

返回一个或多个 draft。

### 使用原则

- 固定时间事项优先转成 `calendar` draft
- 模糊任务优先转成 `task` draft
- 无法确定时要保留 ambiguity
- 不直接写正式记录

---

## 长期可扩展工具

当前不是必须，但未来可以扩展：

- `update_record`
- `archive_record`
- `attach_file_to_record`
- `rebuild_search_docs`
- `export_records`

这些工具也应遵守同一个原则：

`tool 只提供能力，不替 secretary 做意图判断`
