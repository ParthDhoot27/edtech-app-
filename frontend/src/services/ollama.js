const PROVIDER_KEY = "aiProvider";
const OLLAMA_URL_KEY = "ollamaBaseUrl";
const OLLAMA_MODEL_KEY = "ollamaModel";
export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

export function getAiProvider() {
  return window.localStorage.getItem(PROVIDER_KEY) || "Gemini";
}

export function getOllamaSettings() {
  return {
    baseUrl: window.localStorage.getItem(OLLAMA_URL_KEY) || DEFAULT_OLLAMA_URL,
    model: window.localStorage.getItem(OLLAMA_MODEL_KEY) || "",
  };
}

export function saveOllamaSettings({ baseUrl, model }) {
  const normalizedUrl = baseUrl.trim().replace(/\/+$/, "");
  window.localStorage.setItem(OLLAMA_URL_KEY, normalizedUrl);
  window.localStorage.setItem(OLLAMA_MODEL_KEY, model.trim());
}

function normalizedBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("Ollama URL must start with http:// or https://.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

async function ollamaFetch(url, options = {}) {
  const { timeoutMs = 120000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...requestOptions,
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Ollama did not respond in time. Try a smaller input or a faster local model.");
    }
    throw new Error(
      `Could not reach Ollama at ${url}. Make sure Ollama is running and allows this website origin (${window.location.origin}) in OLLAMA_ORIGINS. Browser CORS or local-network permissions can also block this connection.`,
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getMessageFromError(data, fallback) {
  return data?.error || data?.detail || fallback;
}

export async function listOllamaModels(baseUrl = getOllamaSettings().baseUrl) {
  let url;
  try {
    url = normalizedBaseUrl(baseUrl);
  } catch (error) {
    throw new Error(`Invalid Ollama URL: ${error.message}`);
  }
  const response = await ollamaFetch(`${url}/api/tags`, { method: "GET", timeoutMs: 5000 });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getMessageFromError(data, `Ollama returned HTTP ${response.status}.`));
  }
  return (data.models || []).map((item) => item.name).filter(Boolean);
}

async function generate(prompt, { json = false, images = [], messages = null, timeoutMs = 120000, numPredict = 768 } = {}) {
  const { baseUrl, model } = getOllamaSettings();
  if (!model) {
    throw new Error("Choose an installed Ollama model in the provider settings first.");
  }
  let url;
  try {
    url = normalizedBaseUrl(baseUrl);
  } catch (error) {
    throw new Error(`Invalid Ollama URL: ${error.message}`);
  }

  const payload = messages
    ? { model, messages, stream: false }
    : { model, prompt, stream: false, options: { temperature: 0.2, num_predict: numPredict } };
  if (json && !messages) payload.format = "json";
  if (images.length && messages) {
    payload.messages = messages.map((message, index) =>
      index === messages.length - 1 ? { ...message, images } : message,
    );
  }

  const response = await ollamaFetch(`${url}${messages ? "/api/chat" : "/api/generate"}`, {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = getMessageFromError(data, `Ollama returned HTTP ${response.status}.`);
    if (/model .* not found/i.test(reason)) {
      throw new Error(`The selected model is not installed in Ollama. Run: ollama pull ${model}`);
    }
    throw new Error(reason);
  }
  const text = String((messages ? data.message?.content : data.response) || "").trim();
  if (!text) throw new Error("Ollama returned an empty response.");
  return text;
}

function parseJson(text) {
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const firstObject = unfenced.indexOf("{");
  const lastObject = unfenced.lastIndexOf("}");
  return JSON.parse(firstObject >= 0 ? unfenced.slice(firstObject, lastObject + 1) : unfenced);
}

async function generateJson(prompt) {
  const raw = await generate(prompt, { json: true, timeoutMs: 300000, numPredict: 768 });
  try {
    return parseJson(raw);
  } catch {
    const retry = await generate(`${prompt}\n\nReturn one valid JSON object only.`, { json: true, timeoutMs: 300000, numPredict: 768 });
    try {
      return parseJson(retry);
    } catch {
      throw new Error("Ollama returned invalid JSON twice. Try again or choose a model better suited to structured output.");
    }
  }
}

function asStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split("\n").map((item) => item.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  return [];
}

export async function summarizeWithOllama(transcript) {
  const source = transcript.slice(0, 26000);
  const promptFor = (material, instruction = "Create") =>
    `You are an expert academic assistant. ${instruction} a concise study summary from the lecture transcript. Return a JSON object with exactly these keys: overview_paragraphs (exactly 3 short paragraphs, 1-2 sentences each), key_definitions, core_concepts, important_examples, exam_revision_points (each an array of at most 3 concise strings). Keep claims grounded in the transcript. Do not add commentary.\n\nTranscript:\n${material}`;
  let data;
  if (source.length <= 7000) {
    data = await generateJson(promptFor(source));
  } else {
    const notes = [];
    for (let start = 0; start < source.length; start += 6000) {
      notes.push(await generateJson(promptFor(source.slice(start, start + 6000), "Extract the key information and draft")));
    }
    data = await generateJson(
      `Combine these lecture segment summaries into one coherent, non-repetitive study summary. Return exactly 3 overview paragraphs and concise arrays for key_definitions, core_concepts, important_examples, and exam_revision_points. Return JSON only with those keys.\n\nSegment summaries:\n${JSON.stringify(notes)}`,
    );
  }
  const summary = {
    overview_paragraphs: asStringList(data.overview_paragraphs || data.three_paragraph_summary).slice(0, 3),
    key_definitions: asStringList(data.key_definitions),
    core_concepts: asStringList(data.core_concepts),
    important_examples: asStringList(data.important_examples),
    exam_revision_points: asStringList(data.exam_revision_points),
  };
  if (!Object.values(summary).some((items) => items.length)) {
    throw new Error("Ollama produced an empty summary. Try another model or transcript.");
  }
  return summary;
}

export async function chatWithOllama({ message, summary, transcript = "", history = [] }) {
  const prompt = `Answer the user's question using the lecture summary and transcript as the primary sources. If the sources do not contain the answer, say so.\n\nSummary:\n${JSON.stringify(summary)}\n\nRelevant lecture text:\n${transcript.slice(0, 12000)}\n\nConversation:\n${history.map((item) => `${item.role}: ${item.content}`).join("\n")}\n\nUser question: ${message}`;
  return generate(prompt);
}

export async function solverWithOllama({ message, history = [], imageDataUrl }) {
  const messages = [
    { role: "system", content: "You are a patient homework tutor. Explain solutions step by step, check assumptions, and ask for clarification when needed." },
    ...history.map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: item.content })),
    { role: "user", content: message || "Please solve the uploaded image." },
  ];
  const images = imageDataUrl ? [imageDataUrl.split(",", 2)[1]] : [];
  return generate("", { messages, images });
}

export async function generateMcqsWithOllama({ summary, transcript = "" }) {
  const data = await generateJson(`Generate 5 multiple-choice questions grounded in this study material. Return JSON as {"mcqs":[{"question":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"..."}]}. Each question must have exactly 4 options and correct_index must be 0-3.\n\nSummary:\n${JSON.stringify(summary)}\n\nLecture text:\n${transcript.slice(0, 10000)}`);
  const rows = Array.isArray(data) ? data : data.mcqs;
  const mcqs = (rows || []).slice(0, 5).map((item) => {
    const rawIndex = item.correct_index;
    const normalizedIndex = typeof rawIndex === "string" ? rawIndex.trim().toUpperCase() : rawIndex;
    const letterIndex = typeof normalizedIndex === "string" && /^[ABCD]$/.test(normalizedIndex)
      ? "ABCD".indexOf(normalizedIndex)
      : Number(normalizedIndex);
    const options = asStringList(item.options).slice(0, 4);
    if (!item.question || !item.explanation || options.length !== 4 || !Number.isInteger(letterIndex) || letterIndex < 0 || letterIndex > 3) {
      throw new Error("Ollama returned an invalid MCQ. Try generating again or choose another model.");
    }
    return { question: String(item.question), options, correct_index: letterIndex, explanation: String(item.explanation) };
  });
  if (mcqs.length < 3) throw new Error("Ollama produced too few valid MCQs. Try another model.");
  return mcqs;
}

export function printLocalStudyPdf({ summary, mcqs = [] }) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow pop-ups for this site to print your local study PDF.");
  const escapeHtml = (value) => String(value || "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[char]));
  const sections = [
    ["Lecture Synthesis", summary.overview_paragraphs],
    ["Key Definitions", summary.key_definitions],
    ["Core Concepts", summary.core_concepts],
    ["Important Examples", summary.important_examples],
    ["Exam Revision Points", summary.exam_revision_points],
  ];
  const sectionHtml = sections.map(([title, items]) => `<section><h2>${escapeHtml(title)}</h2>${(items || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</section>`).join("");
  const mcqHtml = mcqs.length ? `<section><h2>Practice Questions</h2>${mcqs.map((item, index) => `<article><h3>${index + 1}. ${escapeHtml(item.question)}</h3><ol type="A">${item.options.map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ol><p><strong>Answer:</strong> ${escapeHtml(item.options[item.correct_index])}</p><p>${escapeHtml(item.explanation)}</p></article>`).join("")}</section>` : "";
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>brainbyts Study Notes</title><style>body{font:16px/1.55 Georgia,serif;color:#17212b;max-width:780px;margin:40px auto;padding:0 24px}h1{font:700 28px Arial,sans-serif;border-bottom:2px solid #147d72;padding-bottom:12px}h2{font:700 20px Arial,sans-serif;margin-top:28px;color:#147d72}h3{font:700 16px Arial,sans-serif}li,p{margin:8px 0}article{break-inside:avoid}@media print{body{margin:0 auto}.no-print{display:none}}</style></head><body><button class="no-print" onclick="window.print()">Print / Save as PDF</button><h1>brainbyts Study Notes</h1>${sectionHtml}${mcqHtml}<script>window.addEventListener('load',()=>window.print())<\/script></body></html>`);
  popup.document.close();
}
