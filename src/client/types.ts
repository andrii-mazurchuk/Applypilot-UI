export interface InstanceConfig {
  name: string;
  label: string;
  dir: string;
  resume: string;
  searches: string;
}

export interface InstanceStats {
  discovered: number;
  enriched: number;
  scored: number;
  highFit: number;
  tailored: number;
  cover: number;
  applied: number;
  applyFailed: number;
  responded: number;
  noReply: number;
  dbExists: boolean;
  dbModifiedAt: string | null;
  scoreDistribution: Array<{ score: number; count: number }>;
  bySource: Array<{ site: string; count: number }>;
}

export type ProcessStatus = "idle" | "running" | "done" | "error" | "stopped";
export type RunMode = "run" | "apply";

export interface ProcessState {
  status: ProcessStatus;
  mode: RunMode | null;
  logs: string[];
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
}

export interface InstanceData {
  instance: InstanceConfig;
  stats: InstanceStats;
  process: ProcessState;
}

export interface Job {
  url: string;
  title: string;
  location: string | null;
  site: string | null;
  fit_score: number | null;
  application_url: string | null;
  applied_at: string | null;
  apply_status: string | null;
  apply_error: string | null;
}

export interface ScoredJob {
  url: string;
  title: string;
  salary: string | null;
  location: string | null;
  site: string | null;
  fit_score: number | null;
  score_reasoning: string | null;
  full_description: string | null;
  application_url: string | null;
  tailored_resume_path: string | null;
  cover_letter_path: string | null;
  discovered_at: string | null;
  scored_at: string | null;
  applied_at: string | null;
  apply_status: string | null;
  apply_error: string | null;
}

export interface PdfFile {
  filename: string;
  dir: "tailored_resumes" | "cover_letters";
  type: "resume" | "cover";
  size: number;
}
