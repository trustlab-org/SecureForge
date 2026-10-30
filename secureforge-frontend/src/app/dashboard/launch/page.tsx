"use client";

import { useEffect, useState } from "react";
import {
  Rocket,
  Shield,
  AlertTriangle,
  Play,
  Loader2,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import SimulationStatusBadge from "@/components/SimulationStatusBadge";
import MetricCard from "@/components/MetricCard";
import PageHeader from "@/components/ui/PageHeader";
import { api } from "@/lib/api";
import { useEvents } from "@/hooks/useEvents";
import type { AttackModule, Simulation, SimulationRequest } from "@/types/index";

// ── Default templates for the 8 vuln_scanner tabs ──────────────
const DEFAULT_TEMPLATES = {
  xss: {
    description: "Test for reflected script injection",
    method: "GET",
    payload: "<script>alert(1)</script>",
    param: "q",
    headers: "{}",
  },
  sqli: {
    description: "Test for SQL injection with delay",
    method: "GET",
    payload: "' OR SLEEP(5) --",
    param: "id",
    headers: "{}",
  },
  cmd_injection: {
    description: "Test for OS command injection",
    method: "GET",
    payload: "; ping 127.0.0.1 -c 1",
    param: "file",
    headers: "{}",
  },
  path_traversal: {
    description: "Test for path traversal (read /etc/passwd)",
    method: "GET",
    payload: "../../../etc/passwd",
    param: "file",
    headers: "{}",
  },
  xxe: {
    description: "Test for XML external entity injection",
    method: "POST",
    payload:
      '<?xml version="1.0"?><!DOCTYPE root [<!ENTITY test SYSTEM "file:///etc/passwd">]><root>&test;</root>',
    param: "",
    headers: '{"Content-Type": "application/xml"}',
  },
  ssrf: {
    description: "Test for server-side request forgery (AWS metadata)",
    method: "GET",
    payload: "http://169.254.169.254/latest/meta-data/",
    param: "url",
    headers: "{}",
  },
  bruteforce: {
    description: "Test a single username/password pair",
    method: "POST",
    payload: "",
    param: "",
    headers: '{"Content-Type": "application/x-www-form-urlencoded"}',
    authType: "auto",
    loginUrl: "",
    username: "admin",
    password: "admin",
  },
  portscan: {
    description: "Check if a specific port is open",
    method: "TCP",
    payload: "",
    param: "",
    headers: "{}",
    port: 80,
  },
  csrf: {
    description: "Test for Cross-Site Request Forgery",
    method: "POST",
    payload: "csrf_token=invalid_token_test",
    param: "",
    headers: '{"Content-Type": "application/x-www-form-urlencoded"}',
  },
  ssti: {
    description: "Test for Server-Side Template Injection",
    method: "GET",
    payload: "{{7*7}}",
    param: "q",
    headers: "{}",
  },
};

export default function LaunchPage() {
  const [target, setTarget] = useState("");

  const [jobLabel, setJobLabel] = useState(
    `Simulation-${Date.now().toString().slice(-6)}`
  );

  const [parallel, setParallel] = useState(true);
  const [autonomous, setAutonomous] = useState(false);
  const [detailedEnumeration, setDetailedEnumeration] = useState(false);
  const [sslVerify, setSslVerify] = useState(false);

  // ── Nmap options ────────────────────────────────────────────
  const [scanProfile, setScanProfile] = useState("standard");
  const [portRange, setPortRange] = useState("1-1000");
  const [timingProfile, setTimingProfile] = useState("T4");
  const [subnetDiscovery, setSubnetDiscovery] = useState(false);

  // ── Impact sim options ──────────────────────────────────────
  const [requestCount, setRequestCount] = useState(500);
  const [concurrency, setConcurrency] = useState(50);

  // ── SSH / Webmail brute force options ───────────────────────
  const [sshUser, setSshUser] = useState("");
  const [sshPass, setSshPass] = useState("");
  const [sshAuthType, setSshAuthType] = useState<"ssh" | "webmail">("ssh");
  const [webmailLoginUrl, setWebmailLoginUrl] = useState("");

  // ── Vuln Scanner options ─────────────────────────────────────
  const [vulnTestType, setVulnTestType] = useState("xss");
  const [vulnMethod, setVulnMethod] = useState("GET");
  const [vulnUrl, setVulnUrl] = useState("");
  const [vulnHeaders, setVulnHeaders] = useState("{}");
  const [vulnBody, setVulnBody] = useState("");
  const [vulnTimeout, setVulnTimeout] = useState(10);
  const [vulnInjectParam, setVulnInjectParam] = useState("");
  const [vulnPayload, setVulnPayload] = useState("<script>alert(1)</script>");
  // Brute‑force specific
  const [vulnAuthType, setVulnAuthType] = useState<"auto" | "ssh" | "webmail">("auto");
  const [vulnLoginUrl, setVulnLoginUrl] = useState("");
  const [vulnUsername, setVulnUsername] = useState("admin");
  const [vulnPassword, setVulnPassword] = useState("admin");
  const [vulnCredentialsList, setVulnCredentialsList] = useState<{username: string; password: string}[]>([]);
  const [vulnBruteMode, setVulnBruteMode] = useState<"single" | "bulk">("single");
  // Port‑scan specific
  const [vulnPort, setVulnPort] = useState(80);

  // ── Module state ────────────────────────────────────────────
  const [modules, setModules] = useState<AttackModule[]>([]);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [launching, setLaunching] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function handleReplay(simId: string) {
    try {
      setReplayingId(simId);
      const res = await api.replaySimulation(simId);
      setMessage(`Simulation "${res.name || 'Replay'}" launched successfully! Check Live Operations.`);
      loadSimulations();
    } catch (err: any) {
      alert(`Simulation replay failed: ${err.message || err}`);
    } finally {
      setReplayingId(null);
    }
  }

  useEffect(() => {
    loadModules();
    loadSimulations();
  }, []);

  const events = useEvents();

  useEffect(() => {
    if (events.length > 0) {
      loadSimulations();
    }
  }, [events]);

  async function loadModules() {
    try {
      const data = await api.getModules();
      setModules(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingModules(false);
    }
  }

  function toggleModule(id: string) {
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function loadSimulations() {
    try {
      const data = await api.getSimulations();
      setSimulations(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleLaunch() {
    if (!target) {
      setMessage("Target is required.");
      return;
    }

    if (selectedModules.length === 0) {
      setMessage("Select at least one module.");
      return;
    }

    try {
      if (detailedEnumeration && (selectedModules.includes("impact_sim") || selectedModules.includes("privilege_escalation"))) {
        const confirmed = window.confirm("WARNING: Danger mode is enabled. Modules will run in RED TEAM mode (e.g. destructive actions, real exploits). Continue?");
        if (!confirmed) return;
      }

      setLaunching(true);
      setMessage("");

      const options: any = {
        ssh_user: sshUser,
        ssh_pass: sshPass,
        ssl_verify: sslVerify,
      };

      if (selectedModules.includes("privilege_escalation")) {
        options.privilege_escalation = {
          ssh_user: sshUser,
          ssh_pass: sshPass,
        };
      }

      if (selectedModules.includes("nmap_scan")) {
        options.nmap_scan = {
          profile: scanProfile,
          ports: portRange,
          timing: timingProfile,
          subnet_scan: subnetDiscovery,
        };
      }

      if (selectedModules.includes("impact_sim")) {
        options.impact_sim = {
          ddos_requests: requestCount,
          ddos_concurrency: concurrency,
        };
      }

      if (selectedModules.includes("ssh_bruteforce")) {
        options.ssh_bruteforce = {
          auth_type: sshAuthType,
          ...(sshAuthType === "webmail" && webmailLoginUrl
            ? { webmail_login_url: webmailLoginUrl }
            : {}),
        };
      }

      // ── Vuln Scanner options ──────────────────────────────
      if (selectedModules.includes("vuln_scanner")) {
        let parsedHeaders = {};
        try {
          if (vulnHeaders) parsedHeaders = JSON.parse(vulnHeaders);
        } catch (e) {
          alert("Invalid JSON format in Vulnerability Scanner headers.");
          return;
        }

        const common = {
          test_type: vulnTestType,
          url: vulnUrl || target,
          method: vulnMethod,
          headers: parsedHeaders,
          body: vulnBody,
          timeout: vulnTimeout,
          inject_param: vulnInjectParam,
          payload: vulnBody, // use vulnBody here since textarea only updates vulnBody
        };

        if (vulnTestType === "bruteforce") {
          options.vuln_scanner = {
            ...common,
            auth_type: vulnAuthType,
            login_url: vulnLoginUrl.trim() || "",
            ...(vulnBruteMode === "single" 
              ? { username: vulnUsername.trim(), password: vulnPassword.trim() }
              : { credentials_list: vulnCredentialsList }
            )
          };
        } else if (vulnTestType === "portscan") {
          options.vuln_scanner = {
            ...common,
            port: vulnPort,
          };
        } else {
          options.vuln_scanner = common;
        }
      }

      const payload: SimulationRequest = {
        name: jobLabel,
        target,
        modules: selectedModules,
        parallel,
        autonomous,
        detailed_enumeration: detailedEnumeration,
        options,
      };

      const result = await api.launchSimulation(payload);
      console.log(result);

      setMessage("Simulation launched successfully.");
      loadSimulations();
    } catch (error) {
      console.error(error);
      setMessage("Failed to launch simulation.");
    } finally {
      setLaunching(false);
    }
  }

  // ── Helper: reset vuln_scanner fields when tab changes ──────
  function switchVulnTab(type: string) {
    setVulnTestType(type);
    const template = DEFAULT_TEMPLATES[type as keyof typeof DEFAULT_TEMPLATES] as any;
    if (template) {
      setVulnMethod(template.method || "GET");
      setVulnHeaders(template.headers || "{}");
      setVulnBody(template.payload || "");
      setVulnInjectParam(template.param || "");
      setVulnPayload(template.payload || "");
      if (type === "bruteforce") {
        setVulnAuthType(template.authType || "auto");
        setVulnUsername(template.username || "admin");
        setVulnPassword(template.password || "admin");
        setVulnLoginUrl(template.loginUrl || "");
        setVulnCredentialsList([]);
        setVulnBruteMode("single");
      }
      if (type === "portscan") {
        setVulnPort(template.port || 80);
      }
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Launch Center"
        description="Configure and dispatch BAS attack simulations."
      />

      {/* ── Metric strip ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <MetricCard title="Modules" value={modules.length} icon={Shield} />

        <MetricCard
          title="Selected"
          value={selectedModules.length}
          icon={Rocket}
          color="purple"
        />

        <MetricCard
          title="Parallel"
          value={parallel ? "ON" : "OFF"}
          icon={Rocket}
        />

        <MetricCard
          title="Status"
          value={launching ? "RUNNING" : "READY"}
          icon={launching ? Loader2 : CheckCircle2}
          color={launching ? "amber" : "green"}
        />
      </div>

      {/* ── Main config card ──────────────────────────────── */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-8">Simulation Configuration</h2>

        {/* Name + Target */}
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="text-sm text-white/50">Simulation Name</label>
            <input
              value={jobLabel}
              onChange={(e) => setJobLabel(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
            />
          </div>

          <div>
            <label className="text-sm text-white/50">Target</label>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://example.com"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
            />
          </div>
          <div>
            <label className="text-sm text-white/50">Global SSH User</label>
            <input
              value={sshUser}
              onChange={(e) => setSshUser(e.target.value)}
              placeholder="root"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
            />
          </div>
          <div>
            <label className="text-sm text-white/50">Global SSH Password</label>
            <input
              type="password"
              value={sshPass}
              onChange={(e) => setSshPass(e.target.value)}
              placeholder="secret"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
            />
          </div>
        </div>

        {/* ── Nmap options ─────────────────────────────────── */}
        {selectedModules.includes("nmap_scan") && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-4">
              Nmap Scan Configuration
            </h3>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm text-white/50">Scan Profile</label>
                <select
                  value={scanProfile}
                  onChange={(e) => setScanProfile(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                >
                  <option value="quick">Quick</option>
                  <option value="standard">Standard</option>
                  <option value="full">Full</option>
                  <option value="web">Web</option>
                  <option value="db">Database</option>
                  <option value="devops">DevOps</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-white/50">Port Range</label>
                <input
                  value={portRange}
                  onChange={(e) => setPortRange(e.target.value)}
                  placeholder="1-1000"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                />
              </div>

              <div>
                <label className="text-sm text-white/50">Timing Profile</label>
                <select
                  value={timingProfile}
                  onChange={(e) => setTimingProfile(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                >
                  <option value="T2">T2</option>
                  <option value="T3">T3</option>
                  <option value="T4">T4</option>
                  <option value="T5">T5</option>
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={subnetDiscovery}
                    onChange={() => setSubnetDiscovery(!subnetDiscovery)}
                  />
                  Enable Subnet Discovery
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ── Impact sim options ───────────────────────────── */}
        {selectedModules.includes("impact_sim") && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-4">
              Impact Simulation Configuration
            </h3>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm text-white/50">Request Count</label>
                <input
                  type="number"
                  value={requestCount}
                  onChange={(e) => setRequestCount(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                />
              </div>

              <div>
                <label className="text-sm text-white/50">Concurrency</label>
                <input
                  type="number"
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── SSH / Webmail brute force options ────────────── */}
        {selectedModules.includes("ssh_bruteforce") && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-lg font-semibold mb-1">
              Credential Attack Configuration
            </h3>
            <p className="text-sm text-white/40 mb-6">
              Choose the authentication protocol to brute force.
            </p>

            {/* Radio toggle */}
            <div className="flex gap-6 mb-6">
              {(["ssh", "webmail"] as const).map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => setSshAuthType(type)}
                >
                  <div
                    className={`
                      w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
                      ${
                        sshAuthType === type
                          ? "border-purple-500 bg-purple-500"
                          : "border-white/30 bg-transparent"
                      }
                    `}
                  >
                    {sshAuthType === type && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      sshAuthType === type ? "text-white" : "text-white/50"
                    }`}
                  >
                    {type === "ssh" ? "SSH" : "Webmail"}
                  </span>
                </label>
              ))}
            </div>

            {/* SSH info pill */}
            {sshAuthType === "ssh" && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
                Attempts SSH password auth against port 22 (or custom
                ssh_port). Uses asyncssh with adaptive concurrency and
                fail2ban awareness.
              </div>
            )}

            {/* Webmail extra fields */}
            {sshAuthType === "webmail" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  Performs HTTP POST brute force against a webmail
                  login portal. Usually configured for mail login endpoints.
                </div>

                <div>
                  <label className="text-sm text-white/50">
                    Webmail Login URL{" "}
                    <span className="text-white/30">(optional override)</span>
                  </label>
                  <input
                    value={webmailLoginUrl}
                    onChange={(e) => setWebmailLoginUrl(e.target.value)}
                    placeholder="https://mail.example.com/login/"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Vuln Scanner options ───────────────────────────── */}
        {selectedModules.includes("vuln_scanner") && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-lg font-semibold mb-4">Vulnerability Test Scanner</h3>

            {/* Tab buttons */}
            <div className="flex flex-wrap gap-2 mb-6">
              {[
                "xss",
                "sqli",
                "cmd_injection",
                "path_traversal",
                "xxe",
                "ssrf",
                "bruteforce",
                "portscan",
                "csrf",
                "ssti",
              ].map((type) => (
                <button
                  key={type}
                  onClick={() => switchVulnTab(type)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    vulnTestType === type
                      ? "bg-purple-600 text-white"
                      : "bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Conditional fields based on test type */}
            <div className="grid md:grid-cols-2 gap-6">
              {vulnTestType !== "bruteforce" && (
                <div>
                  <label className="text-sm text-white/50">URL (override)</label>
                  <input
                    value={vulnUrl}
                    onChange={(e) => setVulnUrl(e.target.value)}
                    placeholder="Leave empty to use simulation target"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                  />
                </div>
              )}

              {!["bruteforce", "portscan"].includes(vulnTestType) && (
                <>
                  <div>
                    <label className="text-sm text-white/50">Method</label>
                    <select
                      value={vulnMethod}
                      onChange={(e) => setVulnMethod(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-white/50">Headers (JSON)</label>
                    <input
                      value={vulnHeaders}
                      onChange={(e) => setVulnHeaders(e.target.value)}
                      placeholder='{"Content-Type": "application/json"}'
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-white/50">Parameter Name (to inject)</label>
                    <input
                      value={vulnInjectParam}
                      onChange={(e) => setVulnInjectParam(e.target.value)}
                      placeholder="e.g., q, id, file"
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm text-white/50">Payload / Body</label>
                    <textarea
                      value={vulnBody}
                      onChange={(e) => setVulnBody(e.target.value)}
                      placeholder="Enter your test string"
                      rows={3}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="text-sm text-white/50">Timeout (sec)</label>
                <input
                  type="number"
                  value={vulnTimeout}
                  onChange={(e) => setVulnTimeout(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                />
              </div>

              {/* Brute Force — single credential check */}
              {vulnTestType === "bruteforce" && (
                <>
                  <div className="md:col-span-2">
                    <label className="text-sm text-white/50">Auth type</label>
                    <div className="mt-2 flex flex-wrap gap-4">
                      {(["auto", "ssh", "webmail"] as const).map((type) => (
                        <label
                          key={type}
                          className="flex items-center gap-2 cursor-pointer"
                          onClick={() => setVulnAuthType(type)}
                        >
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              vulnAuthType === type
                                ? "border-purple-500 bg-purple-500"
                                : "border-white/30"
                            }`}
                          >
                            {vulnAuthType === type && (
                              <div className="w-1.5 h-1.5 rounded-full bg-white" />
                            )}
                          </div>
                          <span className="text-sm text-white/70 capitalize">{type}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm text-white/50">Login URL
                      <span className="ml-2 text-white/30 text-xs">
                        (leave empty to use Target above)
                      </span>
                    </label>
                    <input
                      value={vulnLoginUrl}
                      onChange={(e) => setVulnLoginUrl(e.target.value)}
                      placeholder="e.g. https://mail.example.com/login/"
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <div className="flex gap-4 mb-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          className="accent-purple-500"
                          checked={vulnBruteMode === "single"}
                          onChange={() => setVulnBruteMode("single")}
                        />
                        <span className="text-sm text-white/80">Single Credential</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          className="accent-purple-500"
                          checked={vulnBruteMode === "bulk"}
                          onChange={() => setVulnBruteMode("bulk")}
                        />
                        <span className="text-sm text-white/80">Bulk Upload (CSV/JSON)</span>
                      </label>
                    </div>
                  </div>
                  
                  {vulnBruteMode === "single" ? (
                    <>
                      <div>
                        <label className="text-sm text-white/50">Username</label>
                        <input
                          value={vulnUsername}
                          onChange={(e) => setVulnUsername(e.target.value)}
                          placeholder="e.g. admin"
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                        />
                      </div>
                      <div>
                        <label className="text-sm text-white/50">Password</label>
                        <input
                          type="password"
                          value={vulnPassword}
                          onChange={(e) => setVulnPassword(e.target.value)}
                          placeholder="e.g. secret123"
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="md:col-span-2">
                      <label className="text-sm text-white/50 mb-2 block">Upload Credentials File (Max 100 pairs)</label>
                      <input
                        type="file"
                        accept=".csv,.json"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            try {
                              const content = event.target?.result as string;
                              let parsed: {username: string; password: string}[] = [];
                              
                              if (file.name.endsWith('.json')) {
                                parsed = JSON.parse(content);
                              } else if (file.name.endsWith('.csv')) {
                                const lines = content.split('\n').filter(l => l.trim());
                                // Skip header if it exists
                                const startIdx = lines[0].toLowerCase().includes('username') ? 1 : 0;
                                for (let i = startIdx; i < lines.length; i++) {
                                  const parts = lines[i].split(',');
                                  if (parts.length >= 2) {
                                    parsed.push({
                                      username: parts[0].trim(),
                                      password: parts[1].trim()
                                    });
                                  }
                                }
                              }
                              
                              if (parsed.length > 100) {
                                alert("Maximum 100 credentials allowed. The list will be truncated.");
                                parsed = parsed.slice(0, 100);
                              }
                              setVulnCredentialsList(parsed);
                            } catch (err) {
                              alert("Failed to parse file. Ensure it's valid JSON or CSV.");
                              setVulnCredentialsList([]);
                            }
                          };
                          reader.readAsText(file);
                        }}
                        className="w-full text-sm text-white/70 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-500/20 file:text-purple-300 hover:file:bg-purple-500/30"
                      />
                      
                      {vulnCredentialsList.length > 0 && (
                        <div className="mt-3 text-sm text-green-400">
                          Loaded {vulnCredentialsList.length} credential pair(s).
                        </div>
                      )}

                      <div className="mt-4 grid grid-cols-2 gap-4 text-xs text-white/50">
                        <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                          <div className="font-semibold text-white/70 mb-1">Expected JSON:</div>
                          <pre>
[
  {`{`}"username": "admin", "password": "123"{`}`},
  {`{`}"username": "root", "password": "abc"{`}`}
]
                          </pre>
                        </div>
                        <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                          <div className="font-semibold text-white/70 mb-1">Expected CSV:</div>
                          <pre>
username,password
admin,123
root,abc
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="md:col-span-2 rounded-xl bg-purple-500/10 border border-purple-500/20 px-4 py-3 text-xs text-purple-300">
                    Auto mode probes port 22 first: SSH open → SSH auth test, otherwise → webmail/HTTP login check.
                  </div>
                </>
              )}

              {/* Port Scan specific fields */}
              {vulnTestType === "portscan" && (
                <div>
                  <label className="text-sm text-white/50">Port Number</label>
                  <input
                    type="number"
                    value={vulnPort}
                    onChange={(e) => setVulnPort(Number(e.target.value))}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Module grid ──────────────────────────────────── */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4">Attack Modules</h3>

          {loadingModules ? (
            <div className="text-white/50">Loading modules...</div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {modules.map((module) => {
                const active = selectedModules.includes(module.id);

                return (
                  <button
                    key={module.id}
                    onClick={() => toggleModule(module.id)}
                    className={`
                      text-left rounded-2xl border p-5 transition-all
                      ${
                        active
                          ? "border-purple-500 bg-purple-500/10"
                          : "border-white/10 bg-black/20"
                      }
                    `}
                  >
                    <div className="font-semibold">{module.id}</div>

                    <div className="mt-2 text-sm text-white/60">
                      {module.description}
                    </div>

                    <div className="mt-3 text-xs text-purple-300">
                      {module.tactic}
                    </div>

                    {/* Auth type badge — only on ssh_bruteforce when active */}
                    {module.id === "ssh_bruteforce" && active && (
                      <div className="mt-3">
                        <span
                          className={`
                            inline-block rounded-full px-2 py-0.5 text-xs font-medium
                            ${
                              sshAuthType === "ssh"
                                ? "bg-blue-500/20 text-blue-300"
                                : "bg-amber-500/20 text-amber-300"
                            }
                          `}
                        >
                          {sshAuthType === "ssh" ? "SSH" : "Webmail"}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Flags row ────────────────────────────────────── */}
        <div className="mt-8 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-purple-400 font-semibold border border-purple-500/30 bg-purple-500/10 px-3 py-1 rounded-full cursor-pointer hover:bg-purple-500/20 transition-colors">
            <input
              type="checkbox"
              className="accent-purple-500"
              checked={parallel}
              onChange={() => setParallel(!parallel)}
            />
            Parallel
          </label>

          <label className="flex items-center gap-2 text-cyan-400 font-bold border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 rounded-full cursor-pointer hover:bg-cyan-500/20 transition-colors">
            <input
              type="checkbox"
              className="accent-cyan-500"
              checked={autonomous}
              onChange={() => setAutonomous(!autonomous)}
            />
            Autonomous Mode
          </label>

          <label className="flex items-center gap-2 text-red-500 font-semibold border border-red-500/30 bg-red-500/10 px-3 py-1 rounded-full cursor-pointer hover:bg-red-500/20 transition-colors">
            <input
              type="checkbox"
              className="accent-red-500"
              checked={detailedEnumeration}
              onChange={() => setDetailedEnumeration(!detailedEnumeration)}
            />
            Danger
          </label>

          <label className="flex items-center gap-2 text-emerald-400 font-semibold border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 rounded-full cursor-pointer hover:bg-emerald-500/20 transition-colors">
            <input
              type="checkbox"
              className="accent-emerald-500"
              checked={sslVerify}
              onChange={() => setSslVerify(!sslVerify)}
            />
            SSL Verify
          </label>
        </div>

        {message && (
          <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
            {message}
          </div>
        )}

        <button
          onClick={handleLaunch}
          disabled={launching}
          className="
            mt-8 w-full rounded-2xl
            bg-gradient-to-r from-purple-600 to-blue-600
            py-5 font-bold transition-all
          "
        >
          <div className="flex items-center justify-center gap-3">
            {launching ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Play className="w-5 h-5" />
            )}
            {launching ? "Launching..." : "Dispatch Simulation"}
          </div>
        </button>
      </div>

      {/* ── Active Simulations ───────────────────────────── */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6">Active Simulations</h2>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="p-4 text-left">Name</th>
                <th className="p-4 text-left">Target</th>
                <th className="p-4 text-left">Modules</th>
                <th className="p-4 text-left">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {[...simulations]
                .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                .slice(0, 10)
                .map((simulation) => (
                <tr
                  key={simulation.id ?? simulation.simulation_id}
                  className="border-b border-white/5 hover:bg-white/[0.03]"
                >
                  <td className="p-4">{simulation.name ?? "—"}</td>
                  <td className="p-4">{simulation.target}</td>
                  <td className="p-4">
                    {simulation.modules?.join(", ") ?? "—"}
                  </td>
                  <td className="p-4">
                    <SimulationStatusBadge status={simulation.status} />
                  </td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => { const sid = simulation.id ?? simulation.simulation_id; if (sid) handleReplay(sid); }}
                      disabled={replayingId === (simulation.id ?? simulation.simulation_id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-violet-600 hover:border-violet-500 text-xs font-medium text-white transition-all disabled:opacity-50"
                      title="Replay this simulation immediately (Issue #7)"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${replayingId === (simulation.id ?? simulation.simulation_id) ? "animate-spin" : ""}`} />
                      <span>Replay</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
