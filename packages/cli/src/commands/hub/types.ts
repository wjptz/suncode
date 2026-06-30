export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type StartReviewPolicy = "confirm" | "block" | "bypass";

export interface DisabledHubConfig {
  enabled: false;
  cwd: string;
  configPath: string;
  reason: string;
}

export interface EnabledHubConfig {
  enabled: true;
  cwd: string;
  configPath: string;
  mode: "team";
  projectId: string;
  apiBaseUrl: string;
  developerId: string;
  token?: string;
  startReviewPolicy: StartReviewPolicy;
}

export type HubConfig = DisabledHubConfig | EnabledHubConfig;

export interface HubTaskMeta {
  projectId?: string;
  developerId?: string;
  requirementId?: string;
  requirementRevision?: number;
  taskRole?: "single" | "parent" | "child";
  parentLocalTaskId?: string | null;
  parentRemoteTaskId?: string | null;
  remoteTaskId?: string;
  bindingStatus?: "pending" | "pending_parent" | "bound" | "failed";
}

export interface HubTaskContext {
  taskJsonPath: string;
  taskDir: string;
  localTaskId: string;
  localTaskPath: string;
  task: Record<string, unknown>;
  meta: HubTaskMeta;
}

export interface ObjectRef {
  provider: string;
  objectKey: string;
  versionId?: string | null;
}

export interface HubArtifact {
  path: string;
  type:
    | "prd"
    | "design"
    | "implement"
    | "research"
    | "spec"
    | "implementation_summary"
    | "validation_summary"
    | "retrospective"
    | "reuse_assessment";
  absolutePath: string;
  sha256: string;
  size: number;
  contentType: string;
}

export interface UploadedArtifact extends HubArtifact {
  storage: "minio";
  objectRef: ObjectRef;
  uploadSessionId: string;
}

export interface HubManifestArtifact {
  path: string;
  type: HubArtifact["type"];
  lastSubmittedSha256: string;
  size: number;
  storage?: "minio";
  objectRef?: ObjectRef;
  uploadSessionId?: string;
  remoteArtifactId?: string;
  remoteRevision?: number;
}

export interface HubManifest {
  version: 1;
  projectId?: string;
  requirementId?: string;
  requirementRevision?: number;
  remoteTaskId?: string;
  taskRole?: HubTaskMeta["taskRole"];
  parentRemoteTaskId?: string | null;
  planRevision?: number;
  lastPlanSubmissionId?: string;
  lastPlanBundleHash?: string;
  lastSpecBundleHash?: string;
  lastCompletionBundleHash?: string;
  reviewCursor?: string;
  requirementChangeCursor?: string;
  artifacts: Record<string, HubManifestArtifact>;
}

export type HubCommandStatus =
  | "disabled"
  | "skipped"
  | "created"
  | "submitted"
  | "updated"
  | "downloaded";

export interface HubCommandResult {
  status: HubCommandStatus;
  message?: string;
}
