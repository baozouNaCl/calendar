# Data Directory

这个目录预留给 database 的实际数据文件与导出文件。

理想状态下，这里可以放：

- `chronicle-calendar.db`
- 导出的 JSON / JSONL
- 中间备份文件

当前 `v3` 阶段说明：

- 桌面端 SQLite 的逻辑路径已经固定为：
  `database/data/chronicle-calendar.db`
- 但这个路径是相对于 Tauri 的应用数据目录，而不是当前源码工作区目录
- 也就是说，桌面端真实物理位置会是：
  `App Data/database/data/chronicle-calendar.db`
- 浏览器模式仍然不落盘，只保留当前会话内存态

这意味着：

- 从架构上，真实数据库已经固定挂到 `database/data/` 这条目录语义下
- 从物理文件位置上，它仍由桌面运行时放在应用数据目录中

这样做的好处是：

- 目录语义已经和 `database package` 对齐
- 不会依赖用户当前把源码仓库放在哪个磁盘路径
- 未来迁移时可以明确寻找 `database/data/chronicle-calendar.db`
