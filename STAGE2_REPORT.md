# Stage 2 阶段完成度总结报告 (STAGE2_REPORT.md)

> 注：本报告已按 R1 回退规则更新，如实反映各模块的真实实现程度与缺口。

## 1. 已实现功能 (Implemented)

| 功能项 | 对应要求 | 状态 | 涉及文件路径 |
| :--- | :--- | :--- | :--- |
| **封闭词汇表与规则硬性约束** | 限制 `node.role` 和 `edge.type`；禁止无凭据引入 `must_precede` 序列边，禁止伪造启发式拓扑节点与边 | **已完成** | `/server/understand.ts` |
| **纯代码对账报告 (Reconciliation)** | 统计模型已理解节点数、代码规则占位单元数、节点角色分布、检查边端点有效性与未分类文件 | **已完成** | `/server/understand.ts`<br/>`/src/pages/BlueprintPage.tsx` |
| **证据强校验器 (Evidence Verifier)** | 对所有 `[证据 file:line "quote"]` 进行路径存在性、行号范围及消除空白字符串匹配校验，算出百分比强校验率 | **已完成** | `/server/understand.ts`<br/>`/src/components/EvidenceTagBadge.tsx` |
| **蓝图 UI 交互与 Mermaid 导出** | 全中文蓝图主页，支持 L0~L3 选项卡分层呈现、SVG 节点拓扑图、Mermaid 语法复制及诚实状态展示 | **已完成** | `/src/pages/BlueprintPage.tsx`<br/>`/src/App.tsx` |

---

## 2. 部分实现功能 (Partial)

| 功能项 | 对应要求 | 状态 | 真实缺口说明 | 涉及文件路径 |
| :--- | :--- | :--- | :--- | :--- |
| **理解引擎抽象蓝图合成** | 基于 `inventory.json` 与项目文件生成包含 L0~L3 的 `blueprint.json` | **部分实现** | 依赖有效 `GEMINI_API_KEY`；无 Key 或模型调用失败时不再静默生成启发式拓扑/模板句，而是显式标注 `来源：代码规则（非模型理解）`、`[未知]` 或 `synthesisStatus: 'failed'` | `/server/understand.ts`<br/>`/server/prompts.ts` |
| **硬性依赖反例检索 (Counterexample Pass)** | 对 `must_precede` 边与 `independent_entry` 声明进行模型反向检索 | **部分实现** | 仅遍历 `must_precede` 边并读取 `edge.from` 单元文件片段，尚未对 `independent_entry` 声明执行反例检索；无 Key 或失败时标为 `未测试` / `模型调用失败` | `/server/understand.ts`<br/>`/src/pages/BlueprintPage.tsx` |
| **工程覆盖率计算 (Coverage Table)** | 计算每个文件的阅读状态 (`已读全文` / `已读部分` / `未读`) 与全读率百分比 | **部分实现** | 当前按单元主指令文件、README 及被引用文件真实换行行数计算；其余项目源码文件统一记为 `未读`，尚未做全仓库逐文件模型通读 | `/server/understand.ts`<br/>`/src/pages/BlueprintPage.tsx` |
| **意图双路探针 (Intent Probes)** | 分别基于蓝图 JSON 与原始文件解答核心意图问题，进行双向比对 | **部分实现** | 在无有效 Key 或模型调用失败时标为 `未测试` / `模型调用失败`；即使模型返回双路答案，代码未自动裁决语义一致性，`agrees` 置为 `null`（`需人工比对`） | `/server/understand.ts`<br/>`/src/pages/BlueprintPage.tsx` |

---

## 3. 未实现功能 (Not Implemented - 依后续阶段规划)

以下后续阶段模块状态请参见 `STAGE3_REPORT.md` 与 `STAGE4_REPORT.md`：

| 未实现功能模块 | 规划阶段 | 当前状态说明 | 关联文件路径 |
| :--- | :--- | :--- | :--- |
| **自动语义一致性比对判定** | 阶段 2 缺口 | 意图双路探针未实现自动一致性对比，需人工比对 | `/server/understand.ts` |
