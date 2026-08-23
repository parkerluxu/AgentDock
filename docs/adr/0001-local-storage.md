# ADR-0001：本地存储采用 SQLite + 追加事件表

- 状态：已接受（阶段 0）
- 日期：2026-08-21
- 范围：MVP 本地控制面

## 背景

AgentDock 需要保存 Runtime、Profile、Project、Policy、Session、Run 和运行事件。配置变更不能覆盖历史 Run 快照，进程异常后还需要扫描和恢复未完成的 Run。单纯使用分散 JSON 文件会导致并发写入、查询和迁移逻辑复杂；纯 JSONL 又不适合按 Project/Session/状态检索。

## 决策

MVP 使用一个本地 SQLite 数据库保存结构化实体和追加式 `run_events` 表：

- 结构化实体使用版本化迁移；
- Run 的配置和 Policy 快照在创建时写入，不回溯修改；
- 事件表按序号追加，必要时通过索引查询；
- 大型 stdout/stderr 和 artifacts 只保存索引，内容落在数据目录下的文件中；
- 数据库和 artifacts 默认位于用户数据目录，不进入项目仓库。

当前实现已在保留 Repository 抽象的同时接入 SQLite Run Store。内存 Repository 继续用于领域层隔离测试；SQLite 负责 Session、Run、RunEvent 的本地持久化、WAL、迁移和恢复扫描。

## 备选方案

- **分散 JSON**：安装简单，但并发、查询、迁移和崩溃恢复较弱。
- **仅 JSONL**：事件追加自然，但实体关联查询和配置迁移成本高。
- **嵌入式 KV**：性能可行，但需要额外定义索引和迁移语义，生态与诊断工具不如 SQLite。

## 后果

需要实现数据库迁移、文件权限和备份恢复；作为补偿，数据格式透明、便于导出，且后续 Web/API 查询不需要改变核心模型。
