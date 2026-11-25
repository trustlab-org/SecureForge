"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  RefreshCw,
  Terminal,
  Wifi,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Play,
  GitBranch,
  Layers,
  Search,
  ExternalLink,
  ShieldCheck,
  Check
} from "lucide-react";

import { useWebSocket } from "@/hooks/useWebSocket";

type EventItem = {
  id?: string;
  type?: string;
  timestamp?: string;
  payload?: Record<string, any>;
  severity?: string;
  source?: string;
};

import { api, API_BASE } from "@/lib/api";

function normalizeEvent(event: any): EventItem {
  if (!event) return {};

  if (event.payload && typeof event.payload === "object") {
    return {
      id: event.id,
      type: event.type || event.event_type || "event",
      timestamp: event.timestamp || event.created_at || new Date().toISOString(),
      payload: event.payload,
      severity: event.severity,
      source: event.source,
    };
  }

  if (event.data && typeof event.data === "object") {
    return {
      id: event.id,
      type: event.type || event.data.type || "event",
      timestamp: event.timestamp || event.created_at || new Date().toISOString(),
      payload: event.data,
      severity: event.severity,
      source: event.source,
    };
  }

  return {
    id: event.id,
    type: event.type || "event",
    timestamp: event.timestamp || event.created_at || new Date().toISOString(),
    payload: event.payload || event.data || event,
    severity: event.severity,
    source: event.source,
  };
}

function dedupeEvents(events: EventItem[]) {
  const seen = new Set<string>();
  const result: EventItem[] = [];

  for (const event of events) {
    const key =
      event.id ||
      `${event.timestamp || ""}-${event.type || ""}-${JSON.stringify(event.payload || {})}`;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }

  return result;
}

function formatTs(ts?: string | null): string {
  if (!ts) return "—";
  const s = ts.endsWith("Z") ? ts : ts + "Z";
  return new Date(s).toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function EventPayloadRenderer({ event }: { event: EventItem }) {
  const payload = (event.payload || event) as any;
  
  if (event.type === "raw_event") {
    const rawType = payload.event_type || "INFO";
    const msg = payload.message || "";
    const meta = payload.metadata || {};
    
    return (
      <div className="mt-4">
        <div className="bg-zinc-950/50 rounded-lg p-3 border border-white/[0.05] flex gap-3 items-start">
          <div className={`mt-0.5 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider whitespace-nowrap
            ${rawType.includes('ERROR') || rawType.includes('FAIL') ? 'bg-red-500/20 text-red-400' : 
              rawType.includes('WARN') ? 'bg-amber-500/20 text-amber-400' : 
              rawType.includes('SUCCESS') ? 'bg-emerald-500/20 text-emerald-400' : 
              'bg-blue-500/20 text-blue-400'}`}>
            {rawType}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white/80 font-mono text-xs whitespace-pre-wrap leading-relaxed">{msg}</p>
            {Object.keys(meta).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(meta).map(([k, v]) => (
                  <div key={k} className="bg-black/50 border border-white/5 rounded px-2 py-1 text-[10px] flex gap-1.5 items-center">
                    <span className="text-white/40">{k}:</span>
                    <span className="text-white/70 font-mono truncate max-w-[200px]">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  
  if (event.type === "module.completed" || event.type === "module.started") {
    return (
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 min-w-[140px]">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Module</div>
          <div className="font-mono text-sm text-purple-300">{payload.module || "Unknown"}</div>
        </div>
        {payload.findings_count !== undefined && (
          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 min-w-[140px]">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Findings</div>
            <div className="font-mono text-sm text-amber-300">{payload.findings_count}</div>
          </div>
        )}
      </div>
    );
  }
  
  if (event.type === "vulnerability.found") {
    const details = payload.finding_details || {};
    return (
      <div className="mt-4 bg-zinc-950/80 border border-red-500/30 rounded-xl overflow-hidden shadow-[0_0_15px_rgba(239,68,68,0.1)]">
        <div className="bg-red-500/10 px-4 py-3 border-b border-red-500/20 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <h4 className="text-red-400 font-bold text-sm tracking-wide">{details.title || "Unknown Vulnerability"}</h4>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-white/50 font-mono">{payload.module || "Unknown Module"}</span>
                <span className="text-xs text-white/30">•</span>
                <span className="text-xs text-white/50 font-mono">{payload.target || "N/A"}</span>
              </div>
            </div>
          </div>
          <span className="bg-red-500 text-white text-[10px] px-2.5 py-1 rounded-sm uppercase tracking-widest font-bold shadow-sm shadow-red-500/50">
            {details.severity || "Critical"}
          </span>
        </div>
        
        <div className="p-4 space-y-4">
          {details.evidence ? (
            <div className="bg-black rounded-lg border border-zinc-800 p-3">
              <div className="text-[10px] uppercase tracking-widest text-emerald-500/70 mb-2 font-bold flex items-center gap-2">
                <span>Proof of Exploit / Payload</span>
              </div>
              <pre className="text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">{details.evidence}</pre>
            </div>
          ) : null}

          {details.description ? (
            <p className="text-xs text-white/70 leading-relaxed">{details.description}</p>
          ) : null}
        </div>
      </div>
    );
  }
  
  if (event.type === "simulation.completed" || event.type === "simulation.started" || event.type === "simulation.queued") {
    return (
      <div className="mt-4 bg-white/[0.03] border border-white/10 rounded-xl p-4 flex gap-4 items-center">
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
          <Activity className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h4 className="text-white font-medium text-sm">Simulation {event.type.split('.')[1]}</h4>
          <p className="text-white/50 text-xs font-mono mt-1">ID: {payload.id || payload.sim_id || "Unknown"}</p>
        </div>
      </div>
    );
  }

  return (
    <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 text-[11px] text-white/60 font-mono leading-relaxed whitespace-pre-wrap">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

export default function RealtimeOperations() {
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // Live WebSocket state
  const [recentEvents, setRecentEvents] = useState<EventItem[]>([]);
  const [loadingReplay, setLoadingReplay] = useState(true);
  const [wsUrl, setWsUrl] = useState<string>("");

  // Issue #5: Collapsible Event Stream
  const [isStreamCollapsed, setIsStreamCollapsed] = useState(false);

  // Issue #6: View events from previous simulations
  const [simulationsList, setSimulationsList] = useState<any[]>([]);
  const [selectedSimId, setSelectedSimId] = useState<string>("live");
  const [historicalEvents, setHistoricalEvents] = useState<EventItem[]>([]);
  const [loadingSimEvents, setLoadingSimEvents] = useState(false);

  // Issue #7: Add replay for previous simulations
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySuccessMsg, setReplaySuccessMsg] = useState<string | null>(null);

  // WebSocket connection initialization
  useEffect(() => {
    let mounted = true;
    api.getWebSocketTicket().then(res => {
      if (mounted && res?.ticket) {
        setWsUrl(api.getWebSocketUrl(res.ticket));
      }
    }).catch(err => console.error("Failed to fetch WS ticket:", err));
    return () => { mounted = false; };
  }, []);

  const socketState = useWebSocket(wsUrl) as any;
  const connected = Boolean(socketState?.connected);
  const liveMessages: EventItem[] = Array.isArray(socketState?.messages)
    ? socketState.messages.map(normalizeEvent)
    : Array.isArray(socketState)
      ? socketState.map(normalizeEvent)
      : [];

  // Load simulations list for the selector
  const loadSimulationsList = useCallback(async () => {
    try {
      const data = await api.getSimulations();
      if (Array.isArray(data)) {
        setSimulationsList(data);
      }
    } catch (err) {
      console.error("Failed to load simulations list:", err);
    }
  }, []);

  useEffect(() => {
    loadSimulationsList();
  }, [loadSimulationsList]);

  // Load live replay events on mount
  const loadRecentEvents = useCallback(async () => {
    try {
      setLoadingReplay(true);
      const data = await api.getRecentReplayEvents();
      const items: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.events)
          ? data.events
          : Array.isArray(data?.items)
            ? data.items
            : [];
      setRecentEvents(items.map(normalizeEvent));
    } catch (error) {
      console.error(error);
      setRecentEvents([]);
    } finally {
      setLoadingReplay(false);
    }
  }, []);

  useEffect(() => {
    loadRecentEvents();
  }, [loadRecentEvents]);

  // Load historical events when a specific simulation is selected (Issue #6)
  const loadHistoricalEvents = useCallback(async (simId: string) => {
    if (simId === "live") {
      setHistoricalEvents([]);
      return;
    }
    try {
      setLoadingSimEvents(true);
      const data = await api.getSimulationEvents(simId);
      const items: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.events)
          ? data.events
          : [];
      setHistoricalEvents(items.map(normalizeEvent));
    } catch (err) {
      console.error(`Failed to load historical events for ${simId}:`, err);
      // Fallback to getReplay
      try {
        const replayData = await api.getReplay(simId);
        const replayItems: any[] = Array.isArray(replayData) ? replayData : [];
        setHistoricalEvents(replayItems.map(normalizeEvent));
      } catch {
        setHistoricalEvents([]);
      }
    } finally {
      setLoadingSimEvents(false);
    }
  }, []);

  // Handle simulation selection
  const handleSelectSim = (simId: string) => {
    setSelectedSimId(simId);
    setReplaySuccessMsg(null);
    if (simId !== "live") {
      loadHistoricalEvents(simId);
    }
  };

  // Handle 1-click simulation replay (Issue #7)
  const handleReplaySimulation = async (simId: string) => {
    try {
      setIsReplaying(true);
      setReplaySuccessMsg(null);
      const newSim = await api.replaySimulation(simId);
      setReplaySuccessMsg(`Simulation "${newSim.name || 'Replay'}" launched successfully! Switched to live view.`);
      await loadSimulationsList();
      setSelectedSimId("live");
      await loadRecentEvents();
    } catch (err: any) {
      alert(`Simulation replay failed: ${err.message || err}`);
    } finally {
      setIsReplaying(false);
    }
  };

  // Determine active event stream
  const activeEvents = useMemo(() => {
    if (selectedSimId !== "live") {
      return dedupeEvents(historicalEvents).sort((a, b) => {
        const at = new Date(a.timestamp || 0).getTime();
        const bt = new Date(b.timestamp || 0).getTime();
        return at - bt;
      });
    }
    return dedupeEvents([...recentEvents, ...liveMessages]).sort((a, b) => {
      const at = new Date(a.timestamp || 0).getTime();
      const bt = new Date(b.timestamp || 0).getTime();
      return at - bt;
    });
  }, [selectedSimId, historicalEvents, recentEvents, liveMessages]);

  useEffect(() => {
    if (!isStreamCollapsed) {
      terminalRef.current?.scrollTo({
        top: terminalRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [activeEvents.length, isStreamCollapsed]);

  const recentCount = recentEvents.length;
  const liveCount = liveMessages.length;
  const statusText = selectedSimId !== "live" ? "HISTORICAL TIMELINE" : connected ? "CONNECTED" : "DISCONNECTED";
  const statusDot = selectedSimId !== "live" ? "bg-purple-500" : connected ? "bg-green-500" : "bg-red-500";
  const statusColor = selectedSimId !== "live" ? "text-purple-400" : connected ? "text-green-400" : "text-red-400";

  const latestEvent = activeEvents.length > 0 ? activeEvents[activeEvents.length - 1] : null;
  const selectedSim = simulationsList.find(s => s.id === selectedSimId || s.simulation_id === selectedSimId);

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-purple-400 animate-pulse" />
            Live Operations & Telemetry
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Real-time BAS execution stream, historical simulation event review, and one-click adversary replay.
          </p>
        </div>

        <div className="glass-card px-4 py-2.5 flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${statusDot} animate-pulse`} />
          <span className={`text-xs font-semibold tracking-wider uppercase ${statusColor}`}>{statusText}</span>
        </div>
      </div>

      {/* ── TrustLab GitHub Issues Resolved Tracker (Issues #5 through #10) ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-r from-purple-500/[0.05] via-indigo-500/[0.03] to-transparent p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-violet-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/90">
              TrustLab Repository Issues & Roadmap (trustlab-org/SecureForge)
            </h3>
          </div>
          <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            All 6 Roadmap Issues Completed
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
          <div className="p-2.5 rounded-xl bg-black/40 border border-emerald-500/20 flex flex-col justify-between">
            <span className="text-[10px] font-mono text-emerald-400 font-bold">#5 FIXED</span>
            <p className="text-white/80 font-medium text-xs mt-0.5">Collapsible Stream</p>
            <span className="text-[10px] text-white/40 mt-1">Live toggle control</span>
          </div>
          <div className="p-2.5 rounded-xl bg-black/40 border border-emerald-500/20 flex flex-col justify-between">
            <span className="text-[10px] font-mono text-emerald-400 font-bold">#6 FIXED</span>
            <p className="text-white/80 font-medium text-xs mt-0.5">Previous Sim Events</p>
            <span className="text-[10px] text-white/40 mt-1">Selector & timeline</span>
          </div>
          <div className="p-2.5 rounded-xl bg-black/40 border border-emerald-500/20 flex flex-col justify-between">
            <span className="text-[10px] font-mono text-emerald-400 font-bold">#7 FIXED</span>
            <p className="text-white/80 font-medium text-xs mt-0.5">1-Click Replay</p>
            <span className="text-[10px] text-white/40 mt-1">Rerun past attacks</span>
          </div>
          <div className="p-2.5 rounded-xl bg-black/40 border border-emerald-500/20 flex flex-col justify-between">
            <span className="text-[10px] font-mono text-emerald-400 font-bold">#8 FIXED</span>
            <p className="text-white/80 font-medium text-xs mt-0.5">Scheduled Sims</p>
            <span className="text-[10px] text-white/40 mt-1">Cron validation</span>
          </div>
          <div className="p-2.5 rounded-xl bg-black/40 border border-emerald-500/20 flex flex-col justify-between">
            <span className="text-[10px] font-mono text-emerald-400 font-bold">#9 FIXED</span>
            <p className="text-white/80 font-medium text-xs mt-0.5">AWS Cloud Modules</p>
            <span className="text-[10px] text-white/40 mt-1">IMDS, IAM & S3</span>
          </div>
          <div className="p-2.5 rounded-xl bg-black/40 border border-emerald-500/20 flex flex-col justify-between">
            <span className="text-[10px] font-mono text-emerald-400 font-bold">#10 FIXED</span>
            <p className="text-white/80 font-medium text-xs mt-0.5">Phishing Suite</p>
            <span className="text-[10px] text-white/40 mt-1">Lures & tracking</span>
          </div>
        </div>
      </div>

      {/* ── Status Metrics Strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Mode</p>
          <div className="mt-3 flex items-center gap-3">
            <Wifi className="w-5 h-5 text-purple-400" />
            <span className="text-xl font-bold text-white">
              {selectedSimId === "live" ? (connected ? "Live" : "Offline") : "Historical"}
            </span>
          </div>
        </div>

        <div className="glass-card p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Visible Events</p>
          <div className="mt-3 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <span className="text-xl font-bold text-white">{activeEvents.length}</span>
          </div>
        </div>

        <div className="glass-card p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Simulations Logged</p>
          <div className="mt-3 flex items-center gap-3">
            <Layers className="w-5 h-5 text-purple-400" />
            <span className="text-xl font-bold text-white">{simulationsList.length}</span>
          </div>
        </div>

        <div className="glass-card p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Stream State</p>
          <div className="mt-3 flex items-center gap-3">
            {isStreamCollapsed ? (
              <ChevronDown className="w-5 h-5 text-amber-400" />
            ) : (
              <ChevronUp className="w-5 h-5 text-emerald-400" />
            )}
            <span className="text-xl font-bold text-white">
              {isStreamCollapsed ? "Collapsed" : "Expanded"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Replay Success Notification ── */}
      {replaySuccessMsg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Check className="w-5 h-5 text-emerald-400" />
            <span className="text-sm text-emerald-300 font-medium">{replaySuccessMsg}</span>
          </div>
          <button
            onClick={() => setReplaySuccessMsg(null)}
            className="text-xs text-white/40 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Selected Historical Simulation Banner (Issue #6 & #7) ── */}
      {selectedSimId !== "live" && selectedSim && (
        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-5 flex flex-wrap items-center justify-between gap-4 backdrop-blur-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Historical Simulation Review (Issue #6)
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                selectedSim.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
                selectedSim.status === "failed" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
              }`}>
                {selectedSim.status}
              </span>
            </div>
            <h3 className="text-base font-semibold text-white">{selectedSim.name}</h3>
            <p className="text-xs text-white/60 font-mono">
              Target: <span className="text-purple-300">{selectedSim.target}</span> · Modules: {selectedSim.modules?.join(", ") || "—"} · Logged at: {formatTs(selectedSim.created_at)}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Issue #7: 1-Click Replay Button */}
            <button
              onClick={() => handleReplaySimulation(selectedSim.id || selectedSim.simulation_id)}
              disabled={isReplaying}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-xs font-semibold text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/20 disabled:opacity-50"
              title="Rerun this exact simulation with saved parameters (Issue #7)"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isReplaying ? "animate-spin" : ""}`} />
              <span>{isReplaying ? "Launching..." : "Replay Simulation (Issue #7)"}</span>
            </button>

            <button
              onClick={() => handleSelectSim("live")}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/10 bg-black/40 text-xs text-white/70 hover:bg-white/[0.05] transition-colors"
            >
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>Switch to Live Stream</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Main Event Stream Card ── */}
      <div className="glass-card overflow-hidden">
        {/* Stream Header & Controls (Issues #5, #6, #7) */}
        <div className="border-b border-white/10 px-6 py-4 flex flex-wrap items-center justify-between gap-4 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-purple-400" />
            <h2 className="font-semibold text-white text-base">Event Stream</h2>
            <span className="text-xs text-white/40 font-mono">({activeEvents.length} events)</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Issue #6: Simulation Selector Dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40 hidden sm:inline">Stream Source:</span>
              <select
                value={selectedSimId}
                onChange={(e) => handleSelectSim(e.target.value)}
                className="bg-black/60 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500/50 cursor-pointer"
              >
                <option value="live">⚡ Live Stream (Global / Real-Time)</option>
                <optgroup label="Previous Simulations (Issue #6)">
                  {simulationsList.map((sim) => (
                    <option key={sim.id || sim.simulation_id} value={sim.id || sim.simulation_id}>
                      {sim.name} ({sim.target}) — {sim.status}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => {
                if (selectedSimId === "live") {
                  loadRecentEvents();
                } else {
                  loadHistoricalEvents(selectedSimId);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/70 hover:bg-white/[0.04] transition-colors"
              title="Refresh Event Log"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${(loadingReplay || loadingSimEvents) ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Issue #5: Collapsible Toggle Button */}
            <button
              onClick={() => setIsStreamCollapsed(!isStreamCollapsed)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/70 hover:bg-white/[0.04] transition-colors"
              title={isStreamCollapsed ? "Expand Event Stream" : "Collapse Event Stream"}
            >
              {isStreamCollapsed ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5 text-purple-400" />
                  <span>Expand Stream</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5 text-purple-400" />
                  <span>Collapse Stream (Issue #5)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Stream Body (Collapsible) ── */}
        {isStreamCollapsed ? (
          <div className="p-6 bg-black/40 border-t border-white/[0.04] flex items-center justify-between text-xs text-white/50">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse" />
              <span>
                Event stream collapsed ({activeEvents.length} events logged). More room available for dashboard details.
              </span>
              {latestEvent && (
                <span className="hidden md:inline text-white/35 font-mono">
                  · Latest: <span className="text-purple-300">{latestEvent.type}</span> at {formatTs(latestEvent.timestamp)}
                </span>
              )}
            </div>
            <button
              onClick={() => setIsStreamCollapsed(false)}
              className="text-purple-400 hover:text-purple-300 font-semibold underline underline-offset-4"
            >
              Expand Stream (Issue #5)
            </button>
          </div>
        ) : (
          <div
            ref={terminalRef}
            className="h-[650px] overflow-y-auto p-6 space-y-4 font-mono transition-all"
          >
            {(loadingReplay || loadingSimEvents) && activeEvents.length === 0 ? (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center text-white/40">
                <div className="w-14 h-14 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                  <Clock className="w-6 h-6 text-purple-400 animate-pulse" />
                </div>
                <p className="text-lg font-medium text-white/70">
                  {selectedSimId === "live" ? "Loading recent events..." : "Retrieving simulation event timeline..."}
                </p>
                <p className="text-sm mt-2 max-w-md">
                  {selectedSimId === "live"
                    ? "Pulling replay history first, then listening for live telemetry."
                    : `Querying stored event stream for simulation ${selectedSimId}.`}
                </p>
              </div>
            ) : activeEvents.length === 0 ? (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center text-white/40">
                <div className="w-14 h-14 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                  <Terminal className="w-6 h-6 text-purple-400" />
                </div>
                <p className="text-lg font-medium text-white/70">
                  {selectedSimId === "live" ? "No live events recorded yet" : "No events recorded for this simulation"}
                </p>
                <p className="text-sm mt-2 max-w-md">
                  Launch or replay a simulation to stream live activity.
                </p>
              </div>
            ) : (
              activeEvents.map((event: EventItem, index: number) => {
                const timestamp = formatTs(event.timestamp);

                const badgeColor =
                  event.severity === "critical"
                    ? "bg-red-500/10 border-red-500/20 text-red-400"
                    : event.severity === "high"
                      ? "bg-orange-500/10 border-orange-500/20 text-orange-400"
                      : event.severity === "medium"
                        ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                        : event.severity === "low"
                          ? "bg-green-500/10 border-green-500/20 text-green-400"
                          : "bg-purple-500/10 border-purple-500/20 text-purple-300";

                return (
                  <div
                    key={event.id || `${event.timestamp || "event"}-${index}`}
                    className="rounded-2xl border border-white/10 bg-black/30 p-4 hover:border-purple-500/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${badgeColor}`}>
                          {event.type || "event"}
                        </span>
                        {event.source ? (
                          <span className="text-xs text-white/35 font-mono">
                            {event.source}
                          </span>
                        ) : null}
                      </div>

                      <span className="text-xs text-white/40 flex items-center gap-1.5 whitespace-nowrap font-mono">
                        <Clock className="w-3.5 h-3.5" />
                        {timestamp}
                      </span>
                    </div>

                    <EventPayloadRenderer event={event} />
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── Latest Event Snapshot ── */}
      {latestEvent && (
        <div className="glass-card p-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white/90">Latest Event Snapshot</h3>
            <p className="text-xs text-white/50 font-mono mt-0.5">
              Type: <span className="text-purple-300">{latestEvent.type || "event"}</span> · Timestamp: {formatTs(latestEvent.timestamp)}
            </p>
          </div>
          <span className="text-xs text-white/40 font-mono">
            Source: {selectedSimId === "live" ? "Live Stream" : `Simulation ${selectedSimId.slice(0, 8)}`}
          </span>
        </div>
      )}
    </div>
  );
}
