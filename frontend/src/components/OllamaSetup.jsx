import { useEffect, useState } from "react";

import {
  getOllamaSettings,
  listOllamaModels,
  saveOllamaSettings,
} from "../services/api";

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browsers that reject clipboard access on an HTTP origin.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  let copied;
  try {
    textarea.focus();
    textarea.select();
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }

  if (!copied) {
    throw new Error("Clipboard access is unavailable.");
  }
}

function OllamaSetup() {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState("Checking Ollama on this computer...");
  const [isChecking, setIsChecking] = useState(false);
  const [connectionAvailable, setConnectionAvailable] = useState(false);
  const [showOriginHelp, setShowOriginHelp] = useState(false);
  const siteOrigin = window.location.origin;
  const terminalCommand = `OLLAMA_ORIGINS="${siteOrigin}" ollama serve`;
  const systemdCommand = `sudo mkdir -p /etc/systemd/system/ollama.service.d && printf '[Service]\\nEnvironment="OLLAMA_ORIGINS=${siteOrigin}"\\n' | sudo tee /etc/systemd/system/ollama.service.d/zz-ollama-origins.conf >/dev/null && sudo systemctl daemon-reload && sudo systemctl restart ollama`;

  const checkOllama = async (url = baseUrl, preferredModel = model) => {
    setIsChecking(true);
    setStatus("Checking Ollama and installed models...");
    try {
      const installed = await listOllamaModels(url);
      setConnectionAvailable(true);
      setModels(installed);
      const nextModel = installed.includes(preferredModel) ? preferredModel : "";
      setModel(nextModel);
      saveOllamaSettings({ baseUrl: url, model: nextModel });
      setStatus(installed.length ? `Connected. ${installed.length} installed model${installed.length === 1 ? "" : "s"} found.` : "Connected, but no models are installed yet.");
      setShowOriginHelp(false);
    } catch (error) {
      setConnectionAvailable(false);
      setModels([]);
      setStatus(error.message);
      setShowOriginHelp(true);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    const settings = getOllamaSettings();
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    checkOllama(settings.baseUrl, settings.model);
  }, []);

  const handleUrlChange = (event) => {
    setBaseUrl(event.target.value);
    saveOllamaSettings({ baseUrl: event.target.value, model });
  };

  const handleModelChange = (event) => {
    setModel(event.target.value);
    saveOllamaSettings({ baseUrl, model: event.target.value });
  };

  const copyCommand = async (command, successMessage) => {
    try {
      await copyTextToClipboard(command);
      setStatus(successMessage);
    } catch (error) {
      setStatus(`Could not copy the command automatically (${error.message}). Select and copy it below.`);
    }
  };

  return (
    <details className="ollama-setup relative">
      <summary className="cursor-pointer select-none rounded-md border border-slate-500/50 px-2 py-1 text-xs font-medium">
        Ollama setup
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-[min(92vw,390px)] space-y-3 rounded-lg border border-slate-500/40 bg-slate-950 p-4 text-left text-sm text-slate-100 shadow-xl">
        <p className="font-semibold">Your local Ollama</p>
        <p className="text-xs leading-5 text-slate-300">Requests go from this browser directly to Ollama on your computer. Your prompts are not sent to the app backend.</p>
        <label className="grid gap-1 text-xs font-medium" htmlFor="ollama-url">
          Ollama address
          <input id="ollama-url" className="rounded border border-slate-500/60 bg-slate-900 px-2 py-2 text-sm" value={baseUrl} onChange={handleUrlChange} spellCheck="false" />
        </label>
        <div className="grid gap-1 text-xs font-medium">
          <label htmlFor="ollama-model">Installed model</label>
          <select id="ollama-model" className="rounded border border-slate-500/60 bg-slate-900 px-2 py-2 text-sm" value={model} onChange={handleModelChange} disabled={!models.length}>
            <option value="">{models.length ? "Choose a model" : "No models discovered"}</option>
            {models.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <button type="button" className="secondary-btn w-full" disabled={isChecking} onClick={() => checkOllama()}>
          {isChecking ? "Checking..." : "Check connection / refresh models"}
        </button>
        <p className="text-xs leading-5 text-slate-300" role="status">{status}</p>
        {connectionAvailable && !models.length && !isChecking && (
          <p className="text-xs text-slate-300">Install a model in a terminal, for example <code>ollama pull llama3.2:3b</code>, then refresh this list.</p>
        )}
        {showOriginHelp && (
          <div className="space-y-2 rounded border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
            <p>Ollama must allow this exact website origin: <code className="break-all">{siteOrigin}</code>. This setting belongs to the Ollama process on each user&apos;s computer, not the app backend. Do not use a wildcard on a public computer.</p>
            <p>If Ollama is already running as a Linux systemd service, copy this command to add the origin and restart that service:</p>
            <button type="button" className="secondary-btn w-full" onClick={() => copyCommand(systemdCommand, "Linux Ollama service command copied. Run it in a terminal; it will prompt for your sudo password.")}>Copy Linux service command</button>
            <code className="block select-all break-all rounded bg-slate-900 p-2">{systemdCommand}</code>
            <p>For a terminal-managed Ollama process, stop the existing process first, then use:</p>
            <button type="button" className="secondary-btn w-full" onClick={() => copyCommand(terminalCommand, "Terminal start command copied. Stop the existing Ollama process before running it.")}>Copy Linux/macOS terminal command</button>
            <code className="block select-all break-all rounded bg-slate-900 p-2">{terminalCommand}</code>
            <p>For a deployed site, allow its exact origin (including HTTPS and port) on each user&apos;s Ollama; the app backend cannot configure their computer. HTTPS websites may also be restricted by browser local-network or mixed-content policies.</p>
          </div>
        )}
      </div>
    </details>
  );
}

export default OllamaSetup;
