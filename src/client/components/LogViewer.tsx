import React, { useEffect, useRef, useState } from "react";
import type { InstanceData } from "../types.js";

interface Props {
  data: InstanceData;
  onClose: () => void;
}

interface RunMeta {
  filename: string;
  startedAt: string;
  size: number;
}

function formatRunLabel(startedAt: string): string {
  try {
    return new Date(startedAt).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return startedAt;
  }
}

const colorFor = (line: string): string => {
  if (line.startsWith("[system]")) return "text-zinc-500";
  if (line.startsWith("[err]")) return "text-red-400";
  if (/error|failed|exception/i.test(line)) return "text-red-400";
  if (/warn/i.test(line)) return "text-yellow-400";
  if (/applied|success|done|complete/i.test(line)) return "text-emerald-400";
  if (/score|tailor|cover|discover|enrich/i.test(line)) return "text-blue-400";
  return "text-zinc-300";
};

export default function LogViewer({ data, onClose }: Props) {
  const [lines, setLines] = useState<string[]>(data.process.logs);
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [selectedRun, setSelectedRun] = useState<string>("live");
  const [loadingFile, setLoadingFile] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const instanceName = data.instance.name;

  // Fetch run history on open
  useEffect(() => {
    fetch(`/api/instances/${instanceName}/logs`)
      .then((r) => r.json())
      .then((list: RunMeta[]) => setRuns(list))
      .catch(() => {});
  }, [instanceName]);

  // Live SSE stream for the "live" view
  useEffect(() => {
    if (selectedRun !== "live") return;

    setLines(data.process.logs);
    const es = new EventSource(`/api/instances/${instanceName}/logs/stream`);

    es.onmessage = (e) => {
      const line = JSON.parse(e.data) as string;
      setLines((prev) => [...prev, line]);
    };

    es.onerror = () => es.close();
    return () => es.close();
  }, [instanceName, selectedRun, data.process.logs]);

  // Load full log file when a past run is selected
  useEffect(() => {
    if (selectedRun === "live") return;

    setLoadingFile(true);
    setLines([]);

    fetch(`/api/instances/${instanceName}/logs/${selectedRun}`)
      .then((r) => r.text())
      .then((text) => {
        setLines(text.split(/\r?\n/).filter(Boolean));
      })
      .catch(() => setLines(["[system] Failed to load log file."]))
      .finally(() => setLoadingFile(false));
  }, [instanceName, selectedRun]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, autoScroll]);

  const isLive = selectedRun === "live";
  const statusText = isLive
    ? `${data.process.mode ?? "—"} · ${data.process.status}${data.process.startedAt ? ` · started ${new Date(data.process.startedAt).toLocaleTimeString()}` : ""}`
    : `history · ${runs.find((r) => r.filename === selectedRun)?.filename ?? selectedRun}`;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="w-full max-w-3xl bg-zinc-950 border-l border-zinc-800 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-800 shrink-0 gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-white text-lg">{data.instance.label} — Logs</h2>
            <p className="text-zinc-500 text-sm truncate">{statusText}</p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Run selector */}
            <select
              value={selectedRun}
              onChange={(e) => setSelectedRun(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1 focus:outline-none"
            >
              <option value="live">Live / latest</option>
              {runs.map((r) => (
                <option key={r.filename} value={r.filename}>
                  {formatRunLabel(r.startedAt)} ({Math.round(r.size / 1024)}KB)
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-zinc-500 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="accent-zinc-400"
              />
              auto-scroll
            </label>
            <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">✕</button>
          </div>
        </div>

        {/* Log output */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
          {loadingFile ? (
            <p className="text-zinc-600">Loading log file…</p>
          ) : lines.length === 0 ? (
            <p className="text-zinc-600">No output yet.</p>
          ) : (
            lines.map((line, i) => (
              <div key={i} className={colorFor(line)}>{line}</div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
