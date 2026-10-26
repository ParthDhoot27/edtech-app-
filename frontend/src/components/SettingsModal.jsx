import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { getGeminiApiKey, setGeminiApiKey } from "../services/api";

function SettingsModal({ isOpen, onClose }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKey(getGeminiApiKey());
      setSaved(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const handleSave = (event) => {
    event.preventDefault();
    setGeminiApiKey(apiKey);
    setSaved(true);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="settings-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
          >
            <div className="settings-modal-header">
              <div>
                <p className="settings-modal-eyebrow">Provider credentials</p>
                <h2 id="settings-title">Gemini API key</h2>
              </div>
              <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Close settings">×</button>
            </div>

            <form onSubmit={handleSave} className="settings-modal-form">
              <label htmlFor="gemini-api-key">Bring your own key</label>
              <div className="settings-key-field">
                <input
                  id="gemini-api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setSaved(false);
                  }}
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="Paste Gemini API key"
                />
                <button type="button" onClick={() => setShowKey((value) => !value)}>
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
              <p className="settings-modal-note">
                The key is kept in this tab's session storage and sent only to this app's backend with Gemini generation requests. It is not saved by the backend. Use only a backend you trust, and use HTTPS when deployed.
              </p>
              <div className="settings-modal-actions">
                <button type="button" className="secondary-btn" onClick={() => { setApiKey(""); setGeminiApiKey(""); setSaved(true); }}>
                  Clear key
                </button>
                <button type="submit" className="primary-btn">Save for this session</button>
              </div>
              <p className="settings-modal-status" aria-live="polite">
                {saved ? (apiKey.trim() ? "Key saved for this browser session." : "Saved key cleared.") : ""}
              </p>
            </form>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SettingsModal;
