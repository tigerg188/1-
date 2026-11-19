/**
 * 抽象提示词模板库 (Strictly obeying Charter C1: No Case Knowledge)
 * 代码内的所有提示词模板必须使用抽象占位符（如 <UNIT_PATH>, <INSTRUCTION_CONTENT>），绝对禁止包含特定案例名称或硬编码项目词汇。
 */

export const UNIT_CARD_ANALYSIS_PROMPT = `
你是一个通用的 Agent/Skill/Prompt 项目抽象分析器。
请对给定的单元指令文件及相关模块进行确定性分析，提取该单元的属性并生成严格符合 Schema 的 JSON 输出。

【抽象变量输入】:
- 单元相对路径: <UNIT_PATH>
- 指令文件相对路径: <INSTRUCTION_FILE>
- 指令文件文本内容:
<INSTRUCTION_CONTENT>

【封闭词汇表规则】 (必须且只能使用以下允许的值):
1. node.role 只能是以下之一:
   - entry_router (入口路由)
   - specialist (专项功能模块)
   - delivery (产出交付模块)
   - resource (资源/数据模块)
   - script (可执行脚本)
   - config (配置模块)
   - doc (文档模块)
   - unknown (未知)

2. 证据标签规则 (C4):
   关于项目的每一句分析必须附带 evidence:
   - 包含文件行内真实引用时: { "type": "evidence", "filePath": "<FILE_PATH>", "lineStart": <NUMBER>, "lineEnd": <NUMBER>, "quote": "<SHORT_QUOTE>" }
   - 基于推理时: { "type": "inference", "reason": "<REASON>" }
   - 无法确定时: { "type": "unknown" }

【输出 JSON 格式要求】:
返回且仅返回一个符合以下结构的 JSON 对象:
{
  "unitPath": "<UNIT_PATH>",
  "instructionFile": "<INSTRUCTION_FILE>",
  "role": "<ROLE>",
  "purpose": "<PURPOSE_SUMMARY>",
  "activation_conditions": {
    "when_to_use": ["<CONDITION_1>"],
    "when_not_to_use": ["<CONDITION_2>"]
  },
  "declared_independence": false,
  "inputs": ["<INPUT_1>"],
  "outputs": ["<OUTPUT_1>"],
  "external_dependencies": ["<DEP_1>"],
  "runtime_requirements": ["<REQ_1>"],
  "non_goals": ["<NON_GOAL_1>"],
  "l2_internal_workflow": [
    {
      "stepIndex": 1,
      "description": "<STEP_DESCRIPTION>",
      "evidence": { "type": "evidence", "filePath": "<FILE_PATH>", "lineStart": 1, "lineEnd": 5, "quote": "<QUOTE>" }
    }
  ],
  "evidenceTags": [
    { "type": "evidence", "filePath": "<FILE_PATH>", "lineStart": 1, "lineEnd": 5, "quote": "<QUOTE>" }
  ]
}
`;

export const BATCHED_UNIT_CARDS_PROMPT = `
你是一个通用的 Agent/Skill/Prompt 项目批量抽象分析器。
请逐一对以下输入列表中的每个单元提取结构化属性，必须保持每个单元相互独立、绝不把单元内部步骤混为包级节点，所有引用必须来源于该单元对应指令文件的真实原文短句。

【抽象单元批次输入 (JSON 数组)】:
<UNITS_BATCH_JSON>

【封闭词汇表规则】:
1. role 必须且只能是以下之一:
   entry_router | specialist | delivery | resource | script | config | doc | unknown
2. evidence 标签必须优先给出原文真实短引用:
   { "type": "evidence", "filePath": "<INSTRUCTION_FILE>", "lineStart": <NUMBER>, "lineEnd": <NUMBER>, "quote": "<EXACT_SHORT_QUOTE>" }
   确无原文依据时才可用 { "type": "inference", "reason": "<REASON>" } 或 { "type": "unknown" }。

【输出 JSON 格式要求】:
返回且仅返回一个符合以下结构的 JSON 对象，cards 数组长度与 unitPath 必须与输入完全一一对应:
{
  "cards": [
    {
      "unitPath": "<UNIT_PATH>",
      "instructionFile": "<INSTRUCTION_FILE>",
      "role": "<ROLE>",
      "purpose": "<PURPOSE_SUMMARY>",
      "activation_conditions": {
        "when_to_use": ["<CONDITION_1>"],
        "when_not_to_use": ["<CONDITION_2>"]
      },
      "declared_independence": false,
      "inputs": ["<INPUT_1>"],
      "outputs": ["<OUTPUT_1>"],
      "external_dependencies": ["<DEP_1>"],
      "runtime_requirements": ["<REQ_1>"],
      "non_goals": ["<NON_GOAL_1>"],
      "l2_internal_workflow": [
        {
          "stepIndex": 1,
          "description": "<STEP_DESCRIPTION>",
          "evidence": { "type": "evidence", "filePath": "<INSTRUCTION_FILE>", "lineStart": 1, "lineEnd": 5, "quote": "<QUOTE>" }
        }
      ],
      "evidenceTags": [
        { "type": "evidence", "filePath": "<INSTRUCTION_FILE>", "lineStart": 1, "lineEnd": 5, "quote": "<QUOTE>" }
      ]
    }
  ]
}
`;

export const SYNTHESIS_PROMPT = `
你是一个通用的 Agent/Skill 项目蓝图合成器。
请根据给定的所有单元卡片 (Unit Cards) 数据、确定性清单 (Inventory) 以及作者显式声明，合成系统的 L0 意图、L1 包拓扑图及 L3 交付与验收规则。

【抽象变量输入】:
- 项目清单概览:
<INVENTORY_SUMMARY>
- 作者显式声明汇总:
<AUTHOR_STATEMENTS>
- 单元卡片集合:
<UNIT_CARDS_DATA>

【封闭词汇表与限制规则】:
1. edge.type 必须且只能是以下之一:
   - routes_to
   - may_invoke
   - requires_input_from
   - produces_for
   - independent_entry
   - shares_resource
   - must_precede (严格硬性约束: 只有带有说明强制顺序的绝对真实证据引用时才允许使用 must_precede!)

2. 节点 (L1 nodes) 只能使用从 Inventory 或 Unit Cards 中实际存在的单元或文件路径，严禁凭空创造节点！

【输出 JSON 格式要求】:
{
  "l0_intent": {
    "purpose": "<OVERALL_PURPOSE>",
    "intended_users": ["<USER_1>"],
    "stated_non_goals": ["<NON_GOAL_1>"],
    "author_statements": [
      {
        "statement": "<STATEMENT>",
        "evidence": { "type": "evidence", "filePath": "<FILE_PATH>", "lineStart": 1, "lineEnd": 5, "quote": "<QUOTE>" }
      }
    ]
  },
  "l1_topology": {
    "nodes": [
      { "id": "<NODE_ID>", "label": "<LABEL>", "role": "<ROLE>", "unitPath": "<UNIT_PATH>" }
    ],
    "edges": [
      {
        "from": "<NODE_FROM>",
        "to": "<NODE_TO>",
        "type": "<EDGE_TYPE>",
        "description": "<DESC>",
        "evidence": { "type": "evidence", "filePath": "<FILE_PATH>", "lineStart": 1, "lineEnd": 5, "quote": "<QUOTE>" }
      }
    ]
  },
  "l3_delivery_rules": {
    "acceptance_rules": [
      {
        "rule": "<RULE>",
        "evidence": { "type": "evidence", "filePath": "<FILE_PATH>", "lineStart": 1, "lineEnd": 5, "quote": "<QUOTE>" }
      }
    ],
    "delivery_formats": ["<FORMAT_1>"]
  }
}
`;

export const COUNTEREXAMPLE_PROMPT = `
你是一个严谨的代码与文档反例检索器。
请对以下拟定的拓扑断言（如顺序依赖 must_precede 或独立入口 independent_entry）在项目源码与文档中检索是否存在矛盾或反例证据。

【抽象变量输入】:
- 检查断言类型: <ASSERTION_TYPE>
- 断言内容: <CLAIM_TEXT>
- 关联模块/文件: <TARGET_PATH>
- 项目文件上下文:
<FILE_CONTEXT>

【输出 JSON 格式要求】:
{
  "contradictionFound": true,
  "explanation": "<EXPLANATION>",
  "contradictionEvidence": {
    "type": "evidence",
    "filePath": "<FILE_PATH>",
    "lineStart": 1,
    "lineEnd": 5,
    "quote": "<CONTRADICTING_QUOTE>"
  }
}
`;

export const INTENT_PROBES_PROMPT = `
你是一个项目意图对比测试器。
请根据给定的上下文，回答以下由系统生成的问题。

【抽象变量输入】:
- 问题: <QUESTION>
- 上下文:
<CONTEXT_DATA>

【输出 JSON 格式要求】:
{
  "answer": "<ANSWER_TEXT>"
}
`;

export const BATCHED_INTENT_PROBES_PROMPT = `
你是一个项目意图对比测试器。
请严格仅根据下方提供的单一上下文回答问题列表中的每一项；若上下文不足以回答，必须回答“无法确定”。

【抽象变量输入】:
- 问题列表 (JSON 数组):
<QUESTIONS_JSON>
- 上下文:
<CONTEXT_DATA>

【输出 JSON 格式要求】:
返回且仅返回符合以下结构的 JSON 对象，answers 数组必须覆盖全部问题:
{
  "answers": [
    { "question": "<QUESTION_TEXT>", "answer": "<ANSWER_TEXT>" }
  ]
}
`;
