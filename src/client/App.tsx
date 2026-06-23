import React, { useEffect, useState } from "react";
import type { InstanceData, RunMode } from "./types.js";
import InstanceCard from "./components/InstanceCard.js";
import InstanceDetail from "./components/InstanceDetail.js";
import LogViewer from "./components/LogViewer.js";

type Panel = { type: "logs"; data: InstanceData };

export default function App() {
  const [instances, setInstances] = useState<InstanceData[]>([]);
  const [totalApplied, setTotalApplied] = useState<number>(0);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInstances = () => {
    fetch("/api/instances")
      .then((r) => r.json())
      .then((data) => {
        setInstances(data.instances ?? data);
        setTotalApplied(data.crossInstance?.total ?? 0);
        setLastUpdated(new Date());
        setError(null);
      })
      .catch(() => setError("Failed to connect to server"));
  };

  useEffect(() => {
    fetchInstances();
    const interval = setInterval(fetchInstances, 5_000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async (instanceName: string, mode: RunMode) => {
    await fetch(`/api/instances/${instanceName}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    fetchInstances();
  };

  const handleStop = async (instanceName: string) => {
    await fetch(`/api/instances/${instanceName}/stop`, { method: "POST" });
    fetchInstances();
  };

  // Keep panel data fresh on refresh
  useEffect(() => {
    if (!panel) return;
    const fresh = instances.find((d) => d.instance.name === panel.data.instance.name);
    if (fresh) setPanel((p) => p ? { ...p, data: fresh } : null);
  }, [instances]);

  // ── Detail page ─────────────────────────────────────────────────────────────
  if (selectedInstance) {
    const instanceData = instances.find((d) => d.instance.name === selectedInstance);
    if (instanceData) {
      return (
        <>
          <InstanceDetail
            data={instanceData}
            onBack={() => setSelectedInstance(null)}
            onStart={(mode) => handleStart(instanceData.instance.name, mode)}
            onStop={() => handleStop(instanceData.instance.name)}
            onViewLogs={() => setPanel({ type: "logs", data: instanceData })}
          />
          {panel?.type === "logs" && (
            <LogViewer data={panel.data} onClose={() => setPanel(null)} />
          )}
        </>
      );
    }
  }

  // ── Dashboard grid ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-lg tracking-tight">ApplyPilot</span>
          <span className="text-zinc-600 text-sm">dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          {totalApplied > 0 && (
            <span className="text-emerald-400 text-sm font-medium">
              {totalApplied} applied
            </span>
          )}
          {lastUpdated && (
            <span className="text-zinc-600 text-xs">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchInstances} className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
            refresh
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="px-6 py-8 max-w-6xl mx-auto">
        {error ? (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        ) : instances.length === 0 ? (
          <div className="text-zinc-500 text-sm">Loading instances...</div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-zinc-300 text-sm uppercase tracking-widest font-medium">
                {instances.length} instance{instances.length !== 1 ? "s" : ""}
              </h1>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {instances.map((data) => (
                <InstanceCard
                  key={data.instance.name}
                  data={data}
                  onOpen={() => setSelectedInstance(data.instance.name)}
                  onViewLogs={() => setPanel({ type: "logs", data })}
                  onStart={(mode) => handleStart(data.instance.name, mode)}
                  onStop={() => handleStop(data.instance.name)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Panels */}
      {panel?.type === "logs" && (
        <LogViewer data={panel.data} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}
