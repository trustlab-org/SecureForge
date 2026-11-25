export const API_BASE = "/api/proxy/api/v1";

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function request<T>(
  endpoint: string,
  options?: RequestInit,
  retries = 3
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(
      `${API_BASE}${endpoint}`,
      {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options?.headers || {}),
        },
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status >= 500 && retries > 0) {
        // Exponential backoff for 5xx errors
        const backoff = (4 - retries) * 500;
        await delay(backoff);
        return request(endpoint, options, retries - 1);
      }
      throw new Error(`API Error ${response.status}`);
    }

    return response.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError" && retries > 0) {
       const backoff = (4 - retries) * 500;
       await delay(backoff);
       return request(endpoint, options, retries - 1);
    }
    if (err?.name === "AbortError") {
      throw new Error("Request timed out after 30s");
    }
    
    // Network errors
    if (retries > 0) {
      const backoff = (4 - retries) * 500;
      await delay(backoff);
      return request(endpoint, options, retries - 1);
    }
    
    throw err;
  }
}

export const api = {
  getModules() {
    return request<any[]>("/modules/");
  },

  getSimulations() {
    return request<any[]>("/simulations/");
  },

  getWebSocketTicket() {
    return request<{ ticket: string }>("/ws/ticket");
  },

  getWebSocketUrl(ticket: string) {
    if (process.env.NEXT_PUBLIC_WS_URL) {
      return `${process.env.NEXT_PUBLIC_WS_URL}?ticket=${ticket}`;
    }
    if (typeof window === "undefined") {
      return `ws://localhost:8000/ws/events?ticket=${ticket}`;
    }
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    if (proto === "ws") {
      console.warn("Using plaintext WebSocket connection");
    }
    const host = window.location.host;
    return `${proto}://${host}/ws/events?ticket=${ticket}`;
  },
  getMetrics() {
    return request<any>(
      "/metrics/"
    );
  },
  getSimulationSummary() {
    return request<any>(
      "/simulations/summary"
    );
  },

  getSimulationResult(
    simId: string
  ) {
    return request<any>(
      `/results/${simId}`
    );
  },

  getEvents() {
    return request<any[]>(
      "/events/"
    );
  },
  getInfrastructure() {
    return request<any>(
      "/infrastructure/"
    );
  },
  getReplay(
    simId: string
  ) {
    return request<any>(
      `/replay/${simId}`
    );
  },

  getSimulationEvents(
    simId: string
  ) {
    return request<any>(
      `/simulations/${simId}/events`
    );
  },

  replaySimulation(
    simId: string
  ) {
    return request<any>(
      `/simulations/${simId}/replay`,
      {
        method: "POST"
      }
    );
  },

  getRecentReplayEvents() {
    return request<any>(
      "/replay/recent/events"
    );
  },

  discoverTarget(
    target: string
  ) {
    return request<any>(
      `/recon/discover?target=${encodeURIComponent(
        target
      )}`
    );
  },

  launchSimulation(
    payload: any
  ) {
    return request<any>(
      "/simulations/",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  getIntegrations() {
    return request<any[]>(
      "/integrations/"
    );
  },

  createIntegration(data: { name: string; type: string; target: string }) {
    return request<any>(
      "/integrations/",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  },

  deleteIntegration(id: string) {
    return request<any>(
      `/integrations/${id}`,
      {
        method: "DELETE",
      }
    );
  },

  // ── Continuous Schedules ──
  getSchedules(status?: string) {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<any[]>(`/schedules${q}`);
  },

  createSchedule(data: any) {
    return request<any>("/schedules", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  updateSchedule(id: string, data: any) {
    return request<any>(`/schedules/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  deleteSchedule(id: string) {
    return request<any>(`/schedules/${id}`, {
      method: "DELETE",
    });
  },

  pauseSchedule(id: string) {
    return request<any>(`/schedules/${id}/pause`, {
      method: "POST",
    });
  },

  resumeSchedule(id: string) {
    return request<any>(`/schedules/${id}/resume`, {
      method: "POST",
    });
  },

  triggerSchedule(id: string) {
    return request<any>(`/schedules/${id}/trigger`, {
      method: "POST",
    });
  },

  // ── Attack Scenarios (DAG) ──
  getScenarios() {
    return request<any[]>("/scenarios");
  },

  getScenario(id: string) {
    return request<any>(`/scenarios/${id}`);
  },

  createScenario(data: any) {
    return request<any>("/scenarios", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  updateScenario(id: string, data: any) {
    return request<any>(`/scenarios/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  deleteScenario(id: string) {
    return request<any>(`/scenarios/${id}`, {
      method: "DELETE",
    });
  },

  executeScenario(id: string, payload?: any) {
    return request<any>(`/scenarios/${id}/execute`, {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  },

  // ── Cloud Attack Modules ──
  getCloudProfiles() {
    return request<any>("/cloud/profiles");
  },

  runCloudSimulation(data: any) {
    return request<any>("/cloud/simulate", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // ── Phishing Suite ──
  getPhishingCampaigns() {
    return request<any[]>("/phishing/campaigns");
  },

  createPhishingCampaign(data: any) {
    return request<any>("/phishing/campaigns", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getPhishingTemplates() {
    return request<any[]>("/phishing/templates");
  },

  getPhishingCampaignStats(id: string) {
    return request<any>(`/phishing/campaigns/${id}/stats`);
  },

  // ── API Security Audit ──
  getApiAudits() {
    return request<any[]>("/api-audit/scans");
  },

  startApiAudit(data: any) {
    return request<any>("/api-audit/scans", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getApiAuditDetails(id: string) {
    return request<any>(`/api-audit/scans/${id}`);
  },
};