export interface IngestResult {
  workspaceHash: string;
  fileCount: number;
  totalSize: number;
  sourceType: 'github' | 'zip';
  sourceUrl?: string;
  files: Array<{ relPath: string; size: number; sha256: string }>;
}

export interface FileItem {
  relPath: string;
  size: number;
  sha256: string;
}

export interface InventoryData {
  files: FileItem[];
  stats: {
    byExtension: Record<string, { count: number; totalSize: number }>;
    totalFiles: number;
    totalSize: number;
  };
  parsed_frontmatter_and_keys: Array<{
    file: string;
    format: 'markdown' | 'yaml' | 'json' | 'toml' | 'unknown';
    topLevelKeys: string[];
    frontmatter?: Record<string, unknown>;
  }>;
  headings: Array<{
    file: string;
    line: number;
    level: number;
    text: string;
  }>;
  step_and_arrow_lines: Array<{
    file: string;
    line: number;
    text: string;
    matchType: 'arrow' | 'step';
  }>;
  relative_links: Array<{
    file: string;
    line: number;
    linkText: string;
    targetPath: string;
  }>;
  standard_format_flags: Record<string, boolean>;
  candidate_entry_points: Array<{
    file: string;
    reason: string;
  }>;
  unit_candidates: Array<{
    dirPath: string;
    instructionFile: string;
    lineCount: number;
    title?: string;
  }>;
}

export interface LedgerEntry {
  id: string;
  time: string;
  stage: string;
  action: string;
  inputs_hash: string;
  outputs_hash: string;
  ref?: {
    workspace_hash?: string;
    file_path?: string;
    details?: string;
  };
}

export interface SelfTestResult {
  timestamp: string;
  forbiddenScan: {
    passed: boolean;
    hitCount: number;
    hits: Array<{ file: string; line: number; keyword: string; text: string }>;
    scannedFilesCount: number;
  };
  inventoryDeterminism: {
    tested: boolean;
    passed: boolean;
    workspaceHash?: string;
    run1Hash?: string;
    run2Hash?: string;
    message: string;
  };
  ledgerIntegrity: {
    passed: boolean;
    totalEntries: number;
    message: string;
  };
}

export type NodeRole =
  | 'entry_router'
  | 'specialist'
  | 'delivery'
  | 'resource'
  | 'script'
  | 'config'
  | 'doc'
  | 'unknown';

export type EdgeType =
  | 'routes_to'
  | 'may_invoke'
  | 'requires_input_from'
  | 'produces_for'
  | 'independent_entry'
  | 'shares_resource'
  | 'must_precede';

export interface EvidenceTag {
  type: 'evidence' | 'inference' | 'unknown';
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  quote?: string;
  reason?: string;
}

export interface UnitCard {
  unitPath: string;
  instructionFile: string;
  role: NodeRole;
  roleSource?: string;
  purpose: string;
  activation_conditions: {
    when_to_use: string[];
    when_not_to_use: string[];
    evidence?: EvidenceTag;
  };
  declared_independence: '是' | '否' | '未知' | boolean;
  inputs: string[];
  outputs: string[];
  external_dependencies: string[];
  runtime_requirements: string[];
  non_goals: string[];
  l2_internal_workflow: Array<{
    stepIndex: number;
    description: string;
    evidence?: EvidenceTag;
  }>;
  evidenceTags: EvidenceTag[];
  analysisSource?: 'model' | 'code_rule' | 'failed';
  analysisNote?: string;
}

export interface L0Intent {
  purpose: string;
  intended_users: string[];
  stated_non_goals: string[];
  author_statements: Array<{
    statement: string;
    evidence: EvidenceTag;
  }>;
}

export interface TopologyNode {
  id: string;
  label: string;
  role: NodeRole;
  unitPath?: string;
}

export interface TopologyEdge {
  from: string;
  to: string;
  type: EdgeType;
  description?: string;
  evidence?: EvidenceTag;
}

export interface L1Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface L2Workflow {
  unitPath: string;
  steps: Array<{
    stepIndex: number;
    description: string;
    evidence?: EvidenceTag;
  }>;
}

export interface L3DeliveryRules {
  acceptance_rules: Array<{
    rule: string;
    evidence?: EvidenceTag;
  }>;
  delivery_formats: string[];
}

export interface ReconciliationReport {
  totalUnitCandidates: number;
  classifiedNodesCount: number;
  modelGeneratedCount: number;
  ruleFallbackCount: number;
  failedCount: number;
  unclassifiedFiles: string[];
  unconnectedUnits: string[];
  roleCounts: Record<NodeRole, number>;
  invalidEdgesCount: number;
  allEdgeEndpointsExist: boolean;
  modelUnderstoodCount?: number;
}

export interface EvidenceVerificationReport {
  totalTags: number;
  verifiedCount: number;
  unverifiedCount: number;
  verificationRate: number;
  tags: Array<{
    tag: EvidenceTag;
    verified: boolean;
    reason: string;
  }>;
}

export interface CounterexampleResult {
  targetType: 'must_precede' | 'independent_entry';
  targetId: string;
  claim: string;
  contradictionFound: boolean;
  contradictionEvidence?: EvidenceTag;
  explanation: string;
  status?: '已检索' | '未测试' | '模型调用失败';
}

export interface CoverageTable {
  overallCoveragePercentage: number;
  files: Array<{
    filePath: string;
    status: '已读全文' | '已读部分' | '未读';
    linesRead: number;
    totalLines: number;
  }>;
}

export interface IntentProbe {
  question: string;
  answerFromBlueprint: string;
  answerFromRawFiles: string;
  agrees: boolean | null;
  status?: '需人工比对' | '未测试' | '模型调用失败';
  notes?: string;
}

export interface BlueprintData {
  workspaceHash: string;
  updatedAt: string;
  l0_intent: L0Intent;
  l1_topology: L1Topology;
  l2_workflows: L2Workflow[];
  l3_delivery_rules: L3DeliveryRules;
  unit_cards: Record<string, UnitCard>;
  reconciliation_report: ReconciliationReport;
  evidence_verification: EvidenceVerificationReport;
  counterexamples: CounterexampleResult[];
  coverage_table: CoverageTable;
  intent_probes: IntentProbe[];
  modelCallsCount: number;
  synthesisStatus?: 'model' | 'code_rule' | 'failed';
  synthesisNote?: string;
}

export interface CapabilityEntry {
  key: string;
  name: string;
  category: string;
  status: 'supported' | 'unsupported' | 'unknown';
  source: 'doc' | 'probe' | 'declared';
  doc_ref?: string;
  probe_result?: string;
  timestamp: string;
}

export type UnitVerdictType = '可直接移植' | '需改写' | '不可移植' | '未知';

export interface UnitFeasibilityVerdict {
  unitPath: string;
  verdict: UnitVerdictType;
  requiredCapabilities: string[];
  blockingCapability?: string;
  reason: string;
  evidenceTags: EvidenceTag[];
  rewritePlan?: string[];
}

export interface FeasibilityEvaluationResult {
  workspaceHash: string;
  updatedAt: string;
  packageVerdict: UnitVerdictType;
  unitVerdicts: UnitFeasibilityVerdict[];
  userLossList: string[];
  capabilityModelSnapshot: Record<string, CapabilityEntry>;
  summary: {
    totalUnits: number;
    directPortableCount: number;
    needRewriteCount: number;
    nonPortableCount: number;
    unknownCount: number;
  };
}

export interface ExecutionStep {
  stepIndex: number;
  timestamp: string;
  stepType: 'user_input' | 'thought' | 'tool_call' | 'model_output' | 'artifact_generated' | 'error';
  toolCalls?: string[];
  truncatedInputOutput: string;
  fullContentHash: string;
  tokensUsed: number;
  error?: string;
}

export interface ArtifactMeta {
  fileName: string;
  relPath: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface ExecutionState {
  workspaceHash: string;
  taskText: string;
  testMode: boolean;
  tokenBudget: number;
  tokensUsed: number;
  status: 'running' | 'paused_quota' | 'incomplete' | 'completed' | 'failed';
  statusMessage: string;
  interactionId?: string;
  environmentId?: string;
  steps: ExecutionStep[];
  artifacts: ArtifactMeta[];
  updatedAt: string;
}

export interface VerificationCriterion {
  id: string;
  source: 'blueprint_l3' | 'task_requirement';
  description: string;
  evidenceRef?: EvidenceTag;
}

export interface CodeCheckResult {
  artifactsExistAndHashMatch: boolean;
  ledgerIsContinuous: boolean;
  claimedFilesExist: boolean;
  routingCompatibleWithBlueprint: boolean;
  details: string[];
}

export interface CriterionJudgement {
  criterionId: string;
  description: string;
  verdict: '满足' | '不满足' | '无法判断';
  evidenceRef?: EvidenceTag;
  reason: string;
}

export interface VerificationReport {
  workspaceHash: string;
  updatedAt: string;
  payloadLoggedPath: string;
  criteria: VerificationCriterion[];
  codeChecks: CodeCheckResult;
  judgements: CriterionJudgement[];
  hasUndecidedCriteria: boolean;
  overallPass: boolean;
  summaryNote: string;
}

export type AcceptanceStatus = '机械通过' | '机械失败' | '模型判断' | '未测试' | '不适用';

export interface AcceptanceTestRecord {
  id: string;
  name: string;
  method: string;
  mechanicalPassCriterion: string;
  rawOutputPath: string;
  status: AcceptanceStatus;
  details: string;
}

export interface ThresholdItem {
  value: number | boolean;
  label: string;
}

export interface SelfAssessmentDimension {
  key: string;
  label: string;
  cites: string[];
  autoCappedScore: number;
  score: number;
  manualConfirmed: boolean;
  capped: boolean;
  capReason: string;
}

export interface BiasDeclaration {
  objectiveMetrics: {
    blueprintEvidenceVerificationRate: number | null;
    blueprintEvidenceDetail: string;
    fileReadCoverageRate: number | null;
    fileReadCoverageDetail: string;
    codeRuleFallbackUnitRatio: number | null;
    codeRuleFallbackDetail: string;
  };
  testedProjectsCount: number;
  renameInvariancePassed: boolean;
  cappedDimensions: Array<{
    key: string;
    label: string;
    score: number;
    reason: string;
  }>;
}

export interface ManualReviewState {
  confirmed: boolean;
  confirmedAt?: string;
  note?: string;
  confirmedDimensions: Record<string, boolean>;
}

export interface AcceptanceRunReport {
  timestamp: string;
  workspaceHash: string | null;
  thresholds: Record<string, ThresholdItem>;
  acceptanceTests: AcceptanceTestRecord[];
  selfAssessment: Record<string, SelfAssessmentDimension>;
  biasDeclaration: BiasDeclaration;
  manualReviews: ManualReviewState;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  provider: string;
  supportsThinking: boolean;
  maxOutputTokens: number;
}

export interface ModelsState {
  activeModelId: string;
  activeModel: ModelOption | null;
  models: ModelOption[];
  cooldownRemainingSec: number;
}

