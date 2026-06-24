import React, { useEffect, useState } from "react";
import type { ScoredJob } from "../types.js";

interface Props {
  instanceName: string;
  instanceLabel: string;
  jobUrl: string;
  onBack: () => void;
  onBackToInstances: () => void;
}

type ApplyStatus = "applied" | "failed" | "skip" | null;

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  applied:    { label: "Applied",   cls: "bg-emerald-900/60 text-emerald-300 border border-emerald-800" },
  failed:     { label: "Failed",    cls: "bg-red-900/60 text-red-300 border border-red-800" },
  skip:       { label: "Skipped",   cls: "bg-zinc-800 text-zinc-400 border border-zinc-700" },
  in_progress:{ label: "In progress", cls: "bg-yellow-900/60 text-yellow-300 border border-yellow-800" },
  skip_dedup: { label: "Duplicate", cls: "bg-zinc-800 text-zinc-500" },
};

function scoreColor(score: number | null): string {
  if (score == null) return "text-zinc-500";
  if (score >= 9) return "text-emerald-400";
  if (score >= 7) return "text-blue-400";
  if (score >= 5) return "text-yellow-400";
  return "text-zinc-500";
}

function scoreBg(score: number | null): string {
  if (score == null) return "bg-zinc-800 border-zinc-700";
  if (score >= 9) return "bg-emerald-950 border-emerald-800";
  if (score >= 7) return "bg-blue-950 border-blue-800";
  if (score >= 5) return "bg-yellow-950 border-yellow-800";
  return "bg-zinc-900 border-zinc-700";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function pdfFilename(txtPath: string): string {
  return txtPath.split("/").pop()!.replace(/\.txt$/, ".pdf");
}

function pdfUrl(instanceName: string, dir: string, file: string): string {
  return `/api/instances/${instanceName}/pdfs?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`;
}

function PdfPane({ title, url }: { title: string; url: string }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80">
        <span className="text-zinc-400 text-xs font-medium uppercase tracking-wide">{title}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">
          Open ↗
        </a>
      </div>
      <iframe src={url} className="flex-1 w-full border-0 bg-zinc-900" title={title} />
    </div>
  );
}

export default function JobDetail({ instanceName, instanceLabel, jobUrl, onBack, onBackToInstances }: Props) {
  const [job, setJob] = useState<ScoredJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [activeDoc, setActiveDoc] = useState<"resume" | "cover">("resume");

  const fetchJob = () => {
    fetch(`/api/instances/${instanceName}/scored-jobs/${encodeURIComponent(jobUrl)}`)
      .then((r) => r.json())
      .then((data) => { setJob(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchJob(); }, [jobUrl]);

  const setStatus = async (status: ApplyStatus) => {
    if (!job || saving) return;
    setSaving(true);
    await fetch(`/api/instances/${instanceName}/scored-jobs`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: job.url, apply_status: status }),
    });
    await fetchJob();
    setSaving(false);
  };

  const applyLink = job?.application_url ?? job?.url ?? null;
  const resumeUrl = job?.tailored_resume_path
    ? pdfUrl(instanceName, "tailored_resumes", pdfFilename(job.tailored_resume_path))
    : null;
  const coverUrl = job?.cover_letter_path
    ? pdfUrl(instanceName, "cover_letters", pdfFilename(job.cover_letter_path))
    : null;
  const activePdfUrl = activeDoc === "resume" ? resumeUrl : coverUrl;

  const currentStatus = job?.apply_status ?? null;
  const statusCfg = currentStatus ? (STATUS_CONFIG[currentStatus] ?? { label: currentStatus.replace(/_/g, " "), cls: "bg-zinc-800 text-zinc-400" }) : null;

  const desc = job?.full_description ?? job?.score_reasoning ?? null;
  const descTrimmed = desc && desc.length > 600 && !descExpanded ? desc.slice(0, 600) + "…" : desc;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-2 flex-shrink-0">
        <button onClick={onBackToInstances} className="text-zinc-600 hover:text-zinc-300 text-sm transition-colors">
          Dashboard
        </button>
        <span className="text-zinc-700">/</span>
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-200 text-sm transition-colors">
          {instanceLabel}
        </button>
        <span className="text-zinc-700">/</span>
        <span className="text-zinc-300 text-sm truncate max-w-xs">{job?.title ?? "Job"}</span>
      </header>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      )}

      {!loading && !job && (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Job not found.</div>
      )}

      {!loading && job && (
        <div className="flex flex-1 overflow-hidden">

          {/* ── Left panel: job info ────────────────────────────────────────── */}
          <div className="w-[420px] flex-shrink-0 overflow-y-auto border-r border-zinc-800 flex flex-col">

            {/* Job header */}
            <div className="p-6 border-b border-zinc-800 space-y-4">
              {/* Score badge + title */}
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-14 h-14 rounded-xl border flex items-center justify-center ${scoreBg(job.fit_score)}`}>
                  <span className={`text-2xl font-bold font-mono ${scoreColor(job.fit_score)}`}>
                    {job.fit_score ?? "?"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-white font-semibold text-base leading-snug">{job.title ?? "Untitled"}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {job.site && (
                      <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{job.site}</span>
                    )}
                    {job.location && (
                      <span className="text-xs text-zinc-500">{job.location}</span>
                    )}
                    {job.salary && (
                      <span className="text-xs text-zinc-400 font-mono">{job.salary}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Current status */}
              <div className="flex items-center gap-3">
                {statusCfg ? (
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusCfg.cls}`}>
                    {statusCfg.label}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-600">Not applied yet</span>
                )}
                {job.applied_at && (
                  <span className="text-xs text-zinc-600">· {fmtDate(job.applied_at)}</span>
                )}
              </div>

              {/* Apply button */}
              {applyLink && (
                <a
                  href={applyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                >
                  Open & Apply ↗
                </a>
              )}
            </div>

            {/* Status actions */}
            <div className="px-6 py-4 border-b border-zinc-800">
              <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Set status</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setStatus("applied")}
                  disabled={saving || currentStatus === "applied"}
                  className="py-2 rounded-lg text-sm font-medium bg-emerald-900/40 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ✓ Applied
                </button>
                <button
                  onClick={() => setStatus("failed")}
                  disabled={saving || currentStatus === "failed"}
                  className="py-2 rounded-lg text-sm font-medium bg-red-900/40 text-red-300 border border-red-800 hover:bg-red-900/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ✗ Failed
                </button>
                <button
                  onClick={() => setStatus("skip")}
                  disabled={saving || currentStatus === "skip"}
                  className="py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => setStatus(null)}
                  disabled={saving || currentStatus === null}
                  className="py-2 rounded-lg text-sm font-medium bg-zinc-900 text-zinc-500 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Reset
                </button>
              </div>
              {job.apply_error && (
                <p className="mt-3 text-xs text-red-400 leading-relaxed">
                  <span className="font-medium">Error: </span>{job.apply_error}
                </p>
              )}
            </div>

            {/* Metadata */}
            <div className="px-6 py-4 border-b border-zinc-800 space-y-1.5 text-xs text-zinc-500">
              {job.discovered_at && <p>Discovered: <span className="text-zinc-400">{fmtDate(job.discovered_at)}</span></p>}
              {job.scored_at && <p>Scored: <span className="text-zinc-400">{fmtDate(job.scored_at)}</span></p>}
              <p className="break-all">
                <span>Source: </span>
                <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2">{job.url}</a>
              </p>
            </div>

            {/* Score reasoning */}
            {job.score_reasoning && (
              <div className="px-6 py-4 border-b border-zinc-800">
                <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">Score reasoning</p>
                <p className="text-zinc-400 text-sm leading-relaxed">{job.score_reasoning}</p>
              </div>
            )}

            {/* Job description */}
            {desc && (
              <div className="px-6 py-4">
                <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">Job description</p>
                <p className="text-zinc-400 text-sm leading-relaxed whitespace-pre-wrap">{descTrimmed}</p>
                {desc.length > 600 && (
                  <button
                    onClick={() => setDescExpanded(!descExpanded)}
                    className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                  >
                    {descExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Right panel: documents ──────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {(resumeUrl || coverUrl) ? (
              <>
                {/* Doc tabs */}
                <div className="flex items-center gap-1 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 flex-shrink-0">
                  {resumeUrl && (
                    <button
                      onClick={() => setActiveDoc("resume")}
                      className={`px-4 py-1.5 rounded text-sm transition-colors ${
                        activeDoc === "resume"
                          ? "bg-zinc-700 text-white"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      Tailored Resume
                    </button>
                  )}
                  {coverUrl && (
                    <button
                      onClick={() => setActiveDoc("cover")}
                      className={`px-4 py-1.5 rounded text-sm transition-colors ${
                        activeDoc === "cover"
                          ? "bg-zinc-700 text-white"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      Cover Letter
                    </button>
                  )}
                </div>

                {/* PDF viewer */}
                <div className="flex-1 overflow-hidden">
                  {activePdfUrl ? (
                    <PdfPane
                      title={activeDoc === "resume" ? "Tailored Resume" : "Cover Letter"}
                      url={activePdfUrl}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                      No document available
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-2">
                <p className="text-sm">No documents generated yet</p>
                <p className="text-xs text-zinc-700">Run tailor + cover stages to generate PDFs</p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
