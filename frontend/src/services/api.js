import axios from "axios";
import {
  chatWithOllama,
  generateMcqsWithOllama,
  getAiProvider,
  getOllamaSettings,
  listOllamaModels,
  printLocalStudyPdf,
  saveOllamaSettings,
  solverWithOllama,
  summarizeWithOllama,
} from "./ollama";

const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").trim();
const runtimeHostBaseUrl =
  typeof window !== "undefined" && window.location?.hostname
    ? `http://${window.location.hostname}:8000`
    : "";

const apiBaseCandidates = Array.from(
  new Set(
    [configuredBaseUrl, runtimeHostBaseUrl, "http://127.0.0.1:8000", "http://localhost:8000"].filter(
      Boolean,
    ),
  ),
);

let activeBaseUrl = apiBaseCandidates[0] || "http://127.0.0.1:8000";
let authToken = "";
const GEMINI_KEY_STORAGE = "gemini-api-key";

const apiClient = axios.create({
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  const nextConfig = config;
  nextConfig.baseURL = activeBaseUrl;
  if (authToken) {
    nextConfig.headers = nextConfig.headers || {};
    nextConfig.headers.Authorization = `Bearer ${authToken}`;
  }
  return nextConfig;
});

function isNetworkOnlyError(error) {
  return axios.isAxiosError(error) && !error.response;
}

async function requestWithFallback(executor, allowFallback = true) {
  const candidates = allowFallback
    ? [activeBaseUrl, ...apiBaseCandidates.filter((item) => item !== activeBaseUrl)]
    : [activeBaseUrl];

  let lastError;
  const previousBaseUrl = activeBaseUrl;

  for (const baseUrl of candidates) {
    activeBaseUrl = baseUrl;
    try {
      return await executor();
    } catch (error) {
      lastError = error;
      if (isNetworkOnlyError(error)) {
        continue;
      }
      throw error;
    }
  }

  activeBaseUrl = previousBaseUrl;
  throw lastError;
}

export function getActiveApiBaseUrl() {
  return activeBaseUrl;
}

export function setAuthToken(token) {
  authToken = (token || "").trim();
}

export function getGeminiApiKey() {
  return window.sessionStorage.getItem(GEMINI_KEY_STORAGE) || "";
}

export function setGeminiApiKey(key) {
  const normalizedKey = (key || "").trim();
  if (normalizedKey) {
    window.sessionStorage.setItem(GEMINI_KEY_STORAGE, normalizedKey);
  } else {
    window.sessionStorage.removeItem(GEMINI_KEY_STORAGE);
  }
}

export { getAiProvider, getOllamaSettings, listOllamaModels, saveOllamaSettings };

function createLocalSessionId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `local-${id}`;
}

export async function checkApiHealth() {
  const response = await requestWithFallback(() => apiClient.get("/health"), true);
  return response.data;
}

export async function authRegister(payload) {
  const response = await requestWithFallback(
    () => apiClient.post("/auth/register", payload),
    false,
  );
  return response.data;
}

export async function authLogin(payload) {
  const response = await requestWithFallback(
    () => apiClient.post("/auth/login", payload),
    false,
  );
  return response.data;
}

export async function fetchAuthMe() {
  const response = await requestWithFallback(() => apiClient.get("/auth/me"), false);
  return response.data;
}

export async function extractCaptions(payload) {
  const response = await requestWithFallback(() => apiClient.post("/extract_captions", payload), false);
  return response.data;
}

export async function fetchVideoMeta(payload) {
  const response = await requestWithFallback(() => apiClient.post("/video_meta", payload), false);
  return response.data;
}

export async function summarizeTranscript(payload) {
  if (getAiProvider() === "Ollama") {
    return {
      session_id: payload.session_id?.startsWith("local-") ? payload.session_id : createLocalSessionId(),
      summary: await summarizeWithOllama(payload.transcript),
    };
  }
  const response = await requestWithFallback(
    () => apiClient.post("/summarize", payload, {
      timeout: 120000,
      headers: getGeminiApiKey() ? { "X-Gemini-Api-Key": getGeminiApiKey() } : {},
    }),
    false,
  );
  return response.data;
}

export async function chatWithSummary(payload) {
  if (getAiProvider() === "Ollama") {
    return {
      session_id: payload.session_id || createLocalSessionId(),
      answer: await chatWithOllama(payload),
    };
  }
  const response = await requestWithFallback(
    () => apiClient.post("/chat", payload, {
      headers: getGeminiApiKey() ? { "X-Gemini-Api-Key": getGeminiApiKey() } : {},
    }),
    false,
  );
  return response.data;
}

export async function solverChat(payload) {
  if (getAiProvider() === "Ollama") {
    return { answer: await solverWithOllama(payload) };
  }
  const response = await requestWithFallback(
    () => apiClient.post("/solver_chat", payload, {
      headers: getGeminiApiKey() ? { "X-Gemini-Api-Key": getGeminiApiKey() } : {},
    }),
    false,
  );
  return response.data;
}

export async function generateMcq(payload) {
  if (getAiProvider() === "Ollama") {
    return {
      session_id: payload.session_id || createLocalSessionId(),
      mcqs: await generateMcqsWithOllama(payload),
    };
  }
  const response = await requestWithFallback(
    () => apiClient.post("/mcq", payload, {
      headers: getGeminiApiKey() ? { "X-Gemini-Api-Key": getGeminiApiKey() } : {},
    }),
    false,
  );
  return response.data;
}

export async function downloadPdf(sessionId, localStudyData = null) {
  if (getAiProvider() === "Ollama" || sessionId?.startsWith("local-")) {
    if (!localStudyData?.summary) {
      throw new Error("Local study notes are unavailable. Generate the summary again before exporting.");
    }
    printLocalStudyPdf(localStudyData);
    return;
  }
  const response = await requestWithFallback(
    () =>
      apiClient.get("/pdf", {
        params: { session_id: sessionId },
        responseType: "blob",
      }),
    false,
  );

  const blob = new Blob([response.data], { type: "application/pdf" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `brainbyts-${sessionId.slice(0, 8)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function getErrorMessage(error) {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        return "The request timed out while waiting for the API. Try a shorter text or try again.";
      }
      return `Unable to reach API server at ${activeBaseUrl}. Ensure backend is running on port 8000 and CORS is configured for your frontend origin.`;
    }

    const responseData = error.response?.data;
    if (typeof responseData === "string" && responseData.trim()) {
      return responseData.trim();
    }

    const detail = responseData?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => item?.msg || item?.message || JSON.stringify(item))
        .join("; ");
    }

    return (
      error.response?.data?.message ||
      error.message ||
      "Request failed"
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error occurred";
}

export default apiClient;
