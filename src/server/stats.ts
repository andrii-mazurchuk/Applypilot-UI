import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { InstanceConfig } from "./manifest.js";

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

export function getStats(instance: InstanceConfig): InstanceStats {
  const dbPath = join(instance.dir, "applypilot.db");

  if (!existsSync(dbPath)) {
    return {
      discovered: 0, enriched: 0, scored: 0, highFit: 0,
      tailored: 0, cover: 0,
      applied: 0, applyFailed: 0, responded: 0, noReply: 0,
      dbExists: false, dbModifiedAt: null,
      scoreDistribution: [], bySource: [],
    };
  }

  const db = new Database(dbPath, { readonly: true });
  const dbModifiedAt = statSync(dbPath).mtime.toISOString();

  try {
    const row = db.query<Record<string, number>, []>(`
      SELECT
        COUNT(*)                                                                    AS discovered,
        SUM(CASE WHEN full_description IS NOT NULL THEN 1 ELSE 0 END)              AS enriched,
        SUM(CASE WHEN fit_score IS NOT NULL THEN 1 ELSE 0 END)                     AS scored,
        SUM(CASE WHEN fit_score >= 7 THEN 1 ELSE 0 END)                            AS highFit,
        SUM(CASE WHEN tailored_resume_path IS NOT NULL THEN 1 ELSE 0 END)          AS tailored,
        SUM(CASE WHEN cover_letter_path IS NOT NULL THEN 1 ELSE 0 END)             AS cover,
        SUM(CASE WHEN applied_at IS NOT NULL THEN 1 ELSE 0 END)                    AS applied,
        SUM(CASE WHEN apply_error IS NOT NULL AND apply_status != 'skip_dedup' THEN 1 ELSE 0 END) AS applyFailed
      FROM jobs
    `).get();

    const scoreDistribution = db.query<{ score: number; count: number }, []>(`
      SELECT fit_score AS score, COUNT(*) AS count
      FROM jobs WHERE fit_score IS NOT NULL
      GROUP BY fit_score ORDER BY fit_score DESC
    `).all();

    const bySource = db.query<{ site: string; count: number }, []>(`
      SELECT site, COUNT(*) AS count
      FROM jobs WHERE site IS NOT NULL
      GROUP BY site ORDER BY count DESC
    `).all();

    return {
      discovered: row?.discovered ?? 0,
      enriched:   row?.enriched   ?? 0,
      scored:     row?.scored     ?? 0,
      highFit:    row?.highFit    ?? 0,
      tailored:   row?.tailored   ?? 0,
      cover:      row?.cover      ?? 0,
      applied:    row?.applied    ?? 0,
      applyFailed: row?.applyFailed ?? 0,
      responded: 0,
      noReply: row?.applied ?? 0,
      dbExists: true,
      dbModifiedAt,
      scoreDistribution,
      bySource,
    };
  } finally {
    db.close();
  }
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

export function getScoredJobs(instance: InstanceConfig): ScoredJob[] {
  const dbPath = join(instance.dir, "applypilot.db");
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query<ScoredJob, []>(`
      SELECT url, title, salary, location, site, fit_score, score_reasoning,
             full_description, application_url, tailored_resume_path, cover_letter_path,
             discovered_at, scored_at, applied_at, apply_status, apply_error
      FROM jobs
      WHERE fit_score IS NOT NULL
      ORDER BY fit_score DESC, title
    `).all();
  } finally {
    db.close();
  }
}

export function getJob(instance: InstanceConfig, url: string): ScoredJob | null {
  const dbPath = join(instance.dir, "applypilot.db");
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query<ScoredJob, [string]>(`
      SELECT url, title, salary, location, site, fit_score, score_reasoning,
             full_description, application_url, tailored_resume_path, cover_letter_path,
             discovered_at, scored_at, applied_at, apply_status, apply_error
      FROM jobs WHERE url = ?
    `).get(url) ?? null;
  } finally {
    db.close();
  }
}

export function updateJobStatus(
  instance: InstanceConfig,
  url: string,
  status: string | null,
  appliedAt: string | null,
): void {
  const dbPath = join(instance.dir, "applypilot.db");
  const db = new Database(dbPath);
  try {
    db.run(
      `UPDATE jobs SET apply_status = ?, applied_at = ? WHERE url = ?`,
      [status, appliedAt, url],
    );
  } finally {
    db.close();
  }
}

export function listPdfs(instance: InstanceConfig): PdfFile[] {
  const results: PdfFile[] = [];
  const dirs: Array<{ dir: "tailored_resumes" | "cover_letters"; type: "resume" | "cover" }> = [
    { dir: "tailored_resumes", type: "resume" },
    { dir: "cover_letters", type: "cover" },
  ];
  for (const { dir, type } of dirs) {
    const dirPath = join(instance.dir, dir);
    if (!existsSync(dirPath)) continue;
    readdirSync(dirPath)
      .filter((f) => f.endsWith(".pdf"))
      .forEach((filename) => {
        const size = statSync(join(dirPath, filename)).size;
        results.push({ filename, dir, type, size });
      });
  }
  return results.sort((a, b) => a.filename.localeCompare(b.filename));
}

export function getCrossInstanceApplied(userDir?: string): { total: number; byInstance: Array<{ instance: string; count: number }> } {
  const dbPath = userDir
    ? join(userDir, "applied.db")
    : join(homedir(), ".applypilot", "applied.db");
  if (!existsSync(dbPath)) return { total: 0, byInstance: [] };
  const db = new Database(dbPath, { readonly: true });
  try {
    const total = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM applied_urls").get()?.n ?? 0;
    const byInstance = db.query<{ instance: string; count: number }, []>(
      "SELECT instance, COUNT(*) AS count FROM applied_urls GROUP BY instance ORDER BY count DESC"
    ).all();
    return { total, byInstance };
  } finally {
    db.close();
  }
}

export function getAppliedJobs(instance: InstanceConfig): Job[] {
  const dbPath = join(instance.dir, "applypilot.db");
  if (!existsSync(dbPath)) return [];

  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query<Job, []>(`
      SELECT url, title, location, site, fit_score,
             application_url, applied_at, apply_status, apply_error
      FROM jobs
      WHERE applied_at IS NOT NULL
      ORDER BY applied_at DESC
    `).all();
  } finally {
    db.close();
  }
}
