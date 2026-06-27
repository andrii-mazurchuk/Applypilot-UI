import React, { useEffect, useRef, useState } from "react";
import type { ScoredJob } from "../types.js";

interface Props {
  instanceName: string;
  instanceLabel: string;
  jobUrl: string;
  onBack: () => void;
  onBackToInstances: () => void;
}

type ApplyStatus = "applied" | "failed" | "skip" | null;

interface ChatMsg {
  id: string;
  role: "user" | "model";
  content: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  applied:     { label: "Applied",    cls: "bg-emerald-900/60 text-emerald-300 border border-emerald-800" },
  failed:      { label: "Failed",     cls: "bg-red-900/60 text-red-300 border border-red-800" },
  skip:        { label: "Skipped",    cls: "bg-zinc-800 text-zinc-400 border border-zinc-700" },
  in_progress: { label: "In progress",cls: "bg-yellow-900/60 text-yellow-300 border border-yellow-800" },
  skip_dedup:  { label: "Duplicate",  cls: "bg-zinc-800 text-zinc-500" },
};

function scoreColor(s: number | null) {
  if (s == null) return "text-zinc-500";
  if (s >= 9) return "text-emerald-400";
  if (s >= 7) return "text-blue-400";
  if (s >= 5) return "text-yellow-400";
  return "text-zinc-500";
}
function scoreBg(s: number | null) {
  if (s == null) return "bg-zinc-800 border-zinc-700";
  if (s >= 9) return "bg-emerald-950 border-emerald-800";
  if (s >= 7) return "bg-blue-950 border-blue-800";
  if (s >= 5) return "bg-yellow-950 border-yellow-800";
  return "bg-zinc-900 border-zinc-700";
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function pdfFilename(txtPath: string) {
  return txtPath.split("/").pop()!.replace(/\.txt$/, ".pdf");
}
function pdfUrl(instanceName: string, dir: string, file: string, bust = 0) {
  return `/api/instances/${instanceName}/pdfs?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}${bust ? `&t=${bust}` : ""}`;
}

// ── RevisedResumeBlock ────────────────────────────────────────────────────────

function RevisedResumeBlock({
  content, onSave, saving,
}: { content: string; onSave: (c: string) => void; saving: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-3 border border-emerald-800 rounded-lg bg-emerald-950/30 overflow-hidden text-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-800/50">
        <span className="text-emerald-400 text-xs font-medium">✓ Revised resume ready</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {expanded ? "Collapse" : "Preview"}
          </button>
          <button
            onClick={() => onSave(content)}
            disabled={saving}
            className="text-xs px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded transition-colors"
          >
            {saving ? "Saving…" : "Save & Regen PDF"}
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="p-3 text-xs text-zinc-300 font-mono overflow-x-auto max-h-60 overflow-y-auto leading-relaxed whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  );
}

// ── message renderer ──────────────────────────────────────────────────────────

function MessageContent({
  content, onSave, saving,
}: { content: string; onSave: (c: string) => void; saving: boolean }) {
  const parts = content.split(/(\[REVISED RESUME\][\s\S]*?\[\/REVISED RESUME\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/\[REVISED RESUME\]([\s\S]*?)\[\/REVISED RESUME\]/);
        if (m) return <RevisedResumeBlock key={i} content={m[1].trim()} onSave={onSave} saving={saving} />;
        return part ? <span key={i} className="whitespace-pre-wrap">{part}</span> : null;
      })}
    </>
  );
}

// ── ChatPanel ─────────────────────────────────────────────────────────────────

function ChatPanel({
  instanceName, jobUrl, onPdfSaved,
}: { instanceName: string; jobUrl: string; onPdfSaved: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [saveResult, setSaveResult] = useState<"ok" | "error" | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setStreaming(true);

    const modelId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: modelId, role: "model", content: "" }]);

    try {
      const res = await fetch(`/api/instances/${instanceName}/jobs/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobUrl,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data);
            if (typeof chunk === "string") {
              full += chunk;
              setMessages((prev) =>
                prev.map((m) => (m.id === modelId ? { ...m, content: full } : m))
              );
            } else if (chunk?.error) {
              full += `\n\n⚠ ${chunk.error}`;
              setMessages((prev) =>
                prev.map((m) => (m.id === modelId ? { ...m, content: full } : m))
              );
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, content: `⚠ ${String(err)}` } : m))
      );
    } finally {
      setStreaming(false);
      textareaRef.current?.focus();
    }
  };

  const saveResume = async (content: string) => {
    setSavingPdf(true);
    setSaveResult(null);
    try {
      const res = await fetch(`/api/instances/${instanceName}/jobs/save-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobUrl, content }),
      });
      if (res.ok) { setSaveResult("ok"); onPdfSaved(); }
      else setSaveResult("error");
    } catch {
      setSaveResult("error");
    } finally {
      setSavingPdf(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-zinc-600 gap-3 px-6">
            <span className="text-3xl">✦</span>
            <p className="text-sm">Ask me to improve your resume for this role.</p>
            <div className="text-xs space-y-1">
              <p className="text-zinc-700">"What's missing compared to the job requirements?"</p>
              <p className="text-zinc-700">"Rewrite the skills section to match this role."</p>
              <p className="text-zinc-700">"Give me a complete revised version."</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-zinc-800 text-zinc-200 rounded-bl-sm"
              }`}
            >
              {msg.role === "model" ? (
                <MessageContent content={msg.content} onSave={saveResume} saving={savingPdf} />
              ) : (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              )}
              {msg.role === "model" && msg.content === "" && streaming && (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              )}
            </div>
          </div>
        ))}

        {saveResult === "ok" && (
          <p className="text-center text-xs text-emerald-400">✓ Resume saved and PDF regenerated.</p>
        )}
        {saveResult === "error" && (
          <p className="text-center text-xs text-red-400">⚠ Save failed — check server logs.</p>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-zinc-800 p-3 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
          }}
          placeholder="Ask about the resume… (Enter to send, Shift+Enter for newline)"
          disabled={streaming}
          rows={2}
          className="flex-1 bg-zinc-800 text-zinc-100 placeholder-zinc-600 text-sm rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-zinc-600 disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || streaming}
          className="flex-shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── PdfPane ───────────────────────────────────────────────────────────────────

function PdfPane({ title, url }: { title: string; url: string }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 flex-shrink-0">
        <span className="text-zinc-400 text-xs font-medium uppercase tracking-wide">{title}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">
          Open ↗
        </a>
      </div>
      <iframe src={url} className="flex-1 w-full border-0 bg-zinc-900" title={title} />
    </div>
  );
}

// ── JobDetail ─────────────────────────────────────────────────────────────────

export default function JobDetail({ instanceName, instanceLabel, jobUrl, onBack, onBackToInstances }: Props) {
  const [job, setJob] = useState<ScoredJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [activeDoc, setActiveDoc] = useState<"resume" | "cover">("resume");
  const [pdfBust, setPdfBust] = useState(0);

  const fetchJob = () =>
    fetch(`/api/instances/${instanceName}/scored-jobs/${encodeURIComponent(jobUrl)}`)
      .then((r) => r.json())
      .then((d) => { setJob(d); setLoading(false); })
      .catch(() => setLoading(false));

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
    ? pdfUrl(instanceName, "tailored_resumes", pdfFilename(job.tailored_resume_path), pdfBust)
    : null;
  const coverUrl = job?.cover_letter_path
    ? pdfUrl(instanceName, "cover_letters", pdfFilename(job.cover_letter_path), pdfBust)
    : null;
  const activePdfUrl = activeDoc === "resume" ? resumeUrl : coverUrl;

  const currentStatus = job?.apply_status ?? null;
  const statusCfg = currentStatus ? (STATUS_CONFIG[currentStatus] ?? { label: currentStatus.replace(/_/g, " "), cls: "bg-zinc-800 text-zinc-400" }) : null;

  const desc = job?.full_description ?? null;
  const descTrimmed = desc && desc.length > 600 && !descExpanded ? desc.slice(0, 600) + "…" : desc;

  const hasDocs = !!(resumeUrl || coverUrl);

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
      {/* Breadcrumb header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-2 flex-shrink-0">
        <button onClick={onBackToInstances} className="text-zinc-600 hover:text-zinc-300 text-sm transition-colors">Dashboard</button>
        <span className="text-zinc-700">/</span>
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-200 text-sm transition-colors">{instanceLabel}</button>
        <span className="text-zinc-700">/</span>
        <span className="text-zinc-300 text-sm truncate max-w-xs">{job?.title ?? "Job"}</span>
      </header>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>}
      {!loading && !job && <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Job not found.</div>}

      {!loading && job && (
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* ── Left: job info ───────────────────────────────────────────────── */}
          <div className="w-[400px] flex-shrink-0 overflow-y-auto border-r border-zinc-800">

            {/* Score + title */}
            <div className="p-6 border-b border-zinc-800 space-y-4">
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-14 h-14 rounded-xl border flex items-center justify-center ${scoreBg(job.fit_score)}`}>
                  <span className={`text-2xl font-bold font-mono ${scoreColor(job.fit_score)}`}>{job.fit_score ?? "?"}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-white font-semibold text-base leading-snug">{job.title ?? "Untitled"}</h1>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {job.site && <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{job.site}</span>}
                    {job.location && <span className="text-xs text-zinc-500">{job.location}</span>}
                    {job.salary && <span className="text-xs text-zinc-400 font-mono">{job.salary}</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {statusCfg
                  ? <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusCfg.cls}`}>{statusCfg.label}</span>
                  : <span className="text-xs text-zinc-600">Not applied yet</span>}
                {job.applied_at && <span className="text-xs text-zinc-600">· {fmtDate(job.applied_at)}</span>}
              </div>

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
                {(
                  [
                    ["applied", "✓ Applied",  "bg-emerald-900/40 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/70"],
                    ["failed",  "✗ Failed",   "bg-red-900/40 text-red-300 border border-red-800 hover:bg-red-900/70"],
                    ["skip",    "Skip",        "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"],
                    [null,      "Reset",       "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:bg-zinc-800"],
                  ] as const
                ).map(([s, label, cls]) => (
                  <button
                    key={String(s)}
                    onClick={() => setStatus(s as ApplyStatus)}
                    disabled={saving || currentStatus === s}
                    className={`py-2 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${cls}`}
                  >
                    {label}
                  </button>
                ))}
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
                Source: <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2">{job.url}</a>
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
                  <button onClick={() => setDescExpanded(!descExpanded)} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                    {descExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Middle: PDF viewer ──────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0 border-r border-zinc-800">
            <div className="flex items-center gap-1 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 flex-shrink-0">
              {hasDocs && (
                <>
                  {resumeUrl && (
                    <button
                      onClick={() => setActiveDoc("resume")}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${activeDoc === "resume" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                    >
                      Resume
                    </button>
                  )}
                  {coverUrl && (
                    <button
                      onClick={() => setActiveDoc("cover")}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${activeDoc === "cover" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                    >
                      Cover Letter
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => setPdfBust(Date.now())}
                className="ml-auto text-xs text-zinc-700 hover:text-zinc-400 transition-colors"
                title="Reload PDF after regeneration"
              >
                ↺ reload
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              {hasDocs && activePdfUrl ? (
                <PdfPane
                  title={activeDoc === "resume" ? "Tailored Resume" : "Cover Letter"}
                  url={activePdfUrl}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
                  <p className="text-sm">No documents generated yet</p>
                  <p className="text-xs text-zinc-700">Run tailor + cover stages to generate PDFs</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: chat ─────────────────────────────────────────────────── */}
          <div className="w-[380px] flex-shrink-0 flex flex-col overflow-hidden border-l border-zinc-800">
            <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 flex-shrink-0 flex items-center gap-2">
              <span className="text-zinc-300 text-sm font-medium">Refine CV</span>
              <span className="text-[10px] text-blue-400 font-medium">✦ AI</span>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <ChatPanel instanceName={instanceName} jobUrl={jobUrl} onPdfSaved={() => setPdfBust(Date.now())} />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
