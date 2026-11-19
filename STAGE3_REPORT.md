# Stage 3 阶段完成度总结报告 (STAGE3_REPORT.md)

> 注：本报告已按 R1 回退规则更新，所有未经真实探针或文档核实的能力默认保持 `unknown` (`未知`)。

## 1. 已实现功能 (Implemented)

| 功能项 | 对应要求 | 状态 | 涉及文件路径 |
| :--- | :--- | :--- | :--- |
| **整包裁决与用户功能损失列表** | 由纯代码聚合单元判决计算整包 Verdict，归纳损失能力列表 (What the user loses) | **已完成** | `/server/feasibility.ts`<br/>`/src/pages/AdaptersPage.tsx` |
| **格式特征驱动的适配器方案生成** | 基于 `inventory.json` 格式标记生成指令文件挂载路径、依赖文件识别及需改写文本计划书（不生成伪代码） | **已完成** | `/server/adapters.ts` |
| **DRY-RUN 校验器与密钥审计** | 生成 Backend Config JSON 骨架，校验容量限制并扫描是否存在明文 API 密钥 | **已完成** | `/server/adapters.ts`<br/>`/src/pages/AdaptersPage.tsx` |
| **适配页 UI Shell** | 纯中文界面呈现 Capability 表格、整包判定与损失列表、逐单元明细、后端与适配器选择及 DRY-RUN 预演面板 | **已完成** | `/src/pages/AdaptersPage.tsx`<br/>`/src/App.tsx` |

---

## 2. 部分实现功能 (Partial)

| 功能项 | 对应要求 | 状态 | 真实缺口说明 | 涉及文件路径 |
| :--- | :--- | :--- | :--- | :--- |
| **声明式平台能力字典 (Capability Model)** | 具备 13 项核心能力配置与持久化；禁止无凭据或探针标记支持 | **部分实现** | 字典结构与持久化已实现；初始全部 13 项能力默认设为 `status: 'unknown', source: 'declared'`，等待真实探针或人工核实文档引用 | `/server/feasibility.ts`<br/>`/data/capability_model.json` |
| **实时探针 (Probes)** | 按能力运行真实探针并写回字典 | **部分实现** | 仅 `structured_output`（需有效 `GEMINI_API_KEY`）执行真实 JSON Schema 模型调用探针；其余 12 项能力探针尚未实现，触发后返回 `未实现` 并保持 `unknown` | `/server/feasibility.ts`<br/>`/server.ts` |
| **项目依赖能力提取与可移植性判定** | 从蓝图提取单元所需能力并比对能力字典 | **部分实现** | 当前仅通过纯代码关键词匹配提取能力需求（已标注 `来源：代码规则（非模型理解）`），未接入模型语义提取；未匹配到关键词时单元判定为 `未知` | `/server/feasibility.ts`<br/>`/src/pages/AdaptersPage.tsx` |
| **统一执行后端接口 (`ExecutionBackend`)** | 定义 `probe / prepare / execute / collect` 接口并实现适配后端 | **部分实现** | 仅实现了接口定义与 `prepare()` 配置生成；`ManagedSandboxBackend.probe()` 与 `PlainModelBackend.probe()` 当前均返回 `available: false`（未实现/未配置真实连通探针） | `/server/adapters.ts` |

---

## 3. 未实现功能 (Not Implemented)

根据规则 **C3 (No Fake Completion)**，以下能力尚未实现真实运行逻辑：

| 未实现功能模块 | 当前状态 | 真实缺口说明 | 关联文件路径 |
| :--- | :--- | :--- | :--- |
| **托管沙盒真实执行与收集** | **未实现** | `ManagedSandboxBackend.execute()` 与 `collect()` 直接抛出 `未实现` 异常，无沙盒容器与文件挂载执行环境 | `/server/adapters.ts` |
| **纯模型 Backend 统一执行接口** | **未实现** | `PlainModelBackend.execute()` 与 `collect()` 直接抛出 `未实现` 异常；当前 Stage 4 执行器绕过该接口直接调用单轮 `generateContent` | `/server/adapters.ts` |
| **其余 12 项能力真实探针** | **未实现** | `web_search`、`url_fetch`、`code_execution`、`filesystem_persist`、`long_output`、`binary_file_read`、`gpu`、`container_runtime`、`background_jobs`、`scheduler`、`remote_mcp`、`ui_hosting` 均未实现真实探测 | `/server/feasibility.ts` |
