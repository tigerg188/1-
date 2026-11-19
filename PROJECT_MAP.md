# 项目模块与代码路径映射映射表 (PROJECT_MAP.md)

本映射表方便评审者快速定位各功能模块在工程源码中的位置。

## 1. 系统核心与架构

| 功能模块 | 代码文件路径 | 职责说明 |
| :--- | :--- | :--- |
| **硬性宪章** | `/CHARTER.md` | 八条不可违背原则定义 (C1~C8) |
| **模型集中配置** | `/config/models.ts` | 集中集中放置模型与 Agent ID (C6 配额友好) |
| **服务器入口** | `/server.ts` | Express API 服务路由与 Vite 中间件 |
| **全套数据模型** | `/src/types.ts` | 跨前后端 TypeScript 接口类型定义 |
| **UI 壳层** | `/src/App.tsx` | 符合 Top Bar Contract 的主导航与页签控制 |

---

## 2. 阶段 1: 运行时导入、确定性清单与证据账本

| 功能模块 | 代码文件路径 | 职责说明 |
| :--- | :--- | :--- |
| **运行时项目导入** | `/server/ingest.ts` | GitHub Zipball 下载与安全解压校验 |
| **导入 UI 界面** | `/src/pages/ImportPage.tsx` | GitHub URL 与 Zip 拖拽上传 |
| **确定性清单引擎** | `/server/inventory.ts` | 纯代码提取文件树、格式矩阵、标题与步骤行 (NO model) |
| **清单 UI 界面** | `/src/pages/InventoryPage.tsx` | 清单分层展示与 raw inventory.json 视图 |
| **证据账本** | `/server/ledger.ts` | Append-only JSONL 读写与完整性校验 |
| **账本 UI 界面** | `/src/pages/LedgerPage.tsx` | 账本表格检索与 `ledger.jsonl` 导出 |
| **确定性自检引擎** | `/server/selftest.ts` | 三大确定性自检 (违禁词扫描、清单确定性、账本只增不减) |
| **自检 UI 界面** | `/src/pages/SelfTestPage.tsx` | 交互式触发自检与日志透视 |

---

## 3. 阶段 2: 蓝图理解与结构提取引擎 (Blueprint)

| 功能模块 | 代码文件路径 | 职责说明 |
| :--- | :--- | :--- |
| **抽象提示词模板** | `/server/prompts.ts` | 使用 `<UNIT_PATH>` 抽象变量，无案例知识 (C1) |
| **蓝图理解引擎** | `/server/understand.ts` | L0~L3 分层蓝图合成、对账报告、强证据校验器与局部反例检索（需有效 Key，否则显式标记代码规则或失败） |
| **显式证据标签** | `/src/components/EvidenceTagBadge.tsx` | `[证据 file:line "quote"]`、`[推断 + reason]` 与 `[未知]` 标签 |
| **蓝图 UI 界面** | `/src/pages/BlueprintPage.tsx` | L0~L3 选项卡、SVG 拓扑图、Mermaid 语法导出、对账面板与人工比对探针视图 |

---

## 4. 阶段 3: 平台可移植性判定与适配引擎

| 功能模块 | 代码文件路径 | 职责说明 |
| :--- | :--- | :--- |
| **声明式能力字典** | `/server/feasibility.ts` | 13 项能力定义与状态持久化 (`capability_model.json`，默认均为 `unknown`) |
| **探针引擎** | `/server/feasibility.ts` | 仅 `structured_output` 具备真实 JSON 模型探针；其余 12 项暂未实现，返回 `unknown` |
| **可移植性判定** | `/server/feasibility.ts` | 纯代码关键词匹配提取需求（标明来源为代码规则）并计算单元/整包 Verdict 与损失列表 |
| **统一执行后端** | `/server/adapters.ts` | `ExecutionBackend` 接口与 `prepare()` 配置生成；`probe()` 返回未就绪，`execute()/collect()` 未实现 |
| **格式特征适配器** | `/server/adapters.ts` | 指令文件适配路径、依赖文件识别与需改写计划书 |
| **DRY-RUN 校验器** | `/server/adapters.ts` | Config JSON 骨架生成、容量检查与明文密钥扫描 |
| **适配 UI 界面** | `/src/pages/AdaptersPage.tsx` | 能力拓扑表格、探针触发按键与 DRY-RUN 校验结果 |

---

## 5. 阶段 4: 任务执行、独立双路验证与报告导出

| 功能模块 | 代码文件路径 | 职责说明 |
| :--- | :--- | :--- |
| **任务执行引擎** | `/server/execute.ts` | 纯模型单轮生成执行、Token 预算记录、账本打卡、单文本文件哈希与 429 重试（非沙盒/非流式） |
| **执行 UI 界面** | `/src/pages/ExecutePage.tsx` | 运行时任务输入（无预设）、Token 仪表条与步骤记录展示 |
| **独立双路验证器** | `/server/verify.ts` | 专属 System Prompt、写盘审计 Payload、代码强校验与独立模型裁决（失败判为 `无法判断`） |
| **验证 UI 界面** | `/src/pages/VerifyPage.tsx` | 推导标准、代码校验、逐条判决表格、Payload 记录路径说明与报告导出 |
| **综合评估报告导出** | `/server/report.ts` | Markdown, HTML, JSON 及 ZIP 档案导出，基于真实状态汇总已知缺口 |

---

## 6. 验收与测试套件

| 功能模块 | 代码文件路径 | 职责说明 |
| :--- | :--- | :--- |
| **验收自动化测试套件** | `/acceptance/runner.ts` | 运行 A0 ~ A16 验收脚本（未实现自动化核验的项保持 `未测试`） |
| **验收报告** | `/ACCEPTANCE_REPORT.md` | 验收测试表格与待重新评估的自评状态表 |
