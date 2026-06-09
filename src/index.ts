export type { Job, JobId, JobState } from "./domain/job.js";
export {
  ScriptPackageSchema,
  MascotStateSchema,
  TemplateIdSchema,
} from "./domain/script-package.js";
export type { ScriptPackage, MascotState, TemplateId } from "./domain/script-package.js";

export type { JobStore } from "./modules/job-store/job-store.js";
export { SqliteJobStore } from "./modules/job-store/job-store.js";

export type {
  ConversationGateway,
  OperatorAction,
  TelegramGatewayConfig,
} from "./modules/conversation-gateway/index.js";
export { TelegramGateway } from "./modules/conversation-gateway/index.js";
export { Runtime, type RuntimeDeps } from "./runtime/runtime.js";
export type { JobEvent, Intent, JobOrchestrator } from "./modules/job-orchestrator/index.js";
export {
  advance,
  DefaultJobOrchestrator,
  IllegalTransitionError,
} from "./modules/job-orchestrator/index.js";
export type {
  ContentGenerator,
  ModelClient,
  ModelRole,
  RoutingConfig,
} from "./modules/content-generator/index.js";
export {
  DEFAULT_ROUTING,
  DefaultContentGenerator,
  OpenRouterModelClient,
} from "./modules/content-generator/index.js";
export type {
  CodeLanguage,
  SandboxRunResult,
  Sandbox,
  Snippet,
  VerificationResultItem,
  VerificationResult,
  CodeVerifier,
} from "./modules/code-verifier/index.js";
export {
  DefaultCodeVerifier,
  E2BSandbox,
  allPassed,
  failureSummaries,
} from "./modules/code-verifier/index.js";
export type {
  VoiceSynthesizer,
  SynthesisResult,
  WordTiming,
  CharAlignment,
  TtsClient,
  ElevenLabsConfig,
} from "./modules/voice-synthesizer/index.js";
export {
  charsToWordTimings,
  ElevenLabsTtsClient,
  DefaultVoiceSynthesizer,
} from "./modules/voice-synthesizer/index.js";
export type {
  MascotSequencer,
  MascotAtlas,
  AtlasFrame,
  MascotCue,
  MascotSegment,
  MascotTrack,
} from "./modules/mascot-sequencer/index.js";
export {
  DEFAULT_STATE_TO_EMOTION,
  loadAtlas,
  buildSegments,
  DefaultMascotSequencer,
} from "./modules/mascot-sequencer/index.js";
export type {
  VideoComposer,
  ComposeInput,
  CoddyVideoProps,
  CoddyMascotTrack,
  CoddyMascotSegment,
  CoddyAtlasFrame,
  CoddyWordTiming,
  HighlightedToken,
  HighlightedLine,
} from "./modules/video-composer/index.js";
export {
  DefaultVideoComposer,
  computeDurationMs,
  frameAt,
  segmentAt,
  activeWordIndex,
  activeStepIndex,
  VIDEO_FPS,
} from "./modules/video-composer/index.js";
export type {
  PublishTarget,
  PublishResultItem,
  PublishResult,
  Publisher,
} from "./modules/publisher/index.js";
export { MockPublisher, allPublished } from "./modules/publisher/index.js";
export type { SchedulerConfig, Scheduler } from "./modules/scheduler/index.js";
export { DefaultScheduler } from "./modules/scheduler/index.js";
