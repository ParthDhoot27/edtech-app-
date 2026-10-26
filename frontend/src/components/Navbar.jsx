import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useSession } from "../context/SessionContext";
import BrandMarkIcon from "./BrandMarkIcon";
import OllamaSetup from "./OllamaSetup";
import SettingsModal from "./SettingsModal";

const primaryNavItems = [
  { to: "/", label: "Landing" },
  { to: "/studio", label: "Studio" },
  { to: "/summary", label: "Summary" },
  { to: "/mcq", label: "MCQ" },
];

const botNavItems = [
  { to: "/homework-bot", label: "Homework Bot", hint: "Image + step-by-step solutions" },
  { to: "/chat-bot", label: "Chat Bot", hint: "Summary-grounded assistant" },
];

const providerOptions = [
  { value: "Gemini", label: "Gemini", hint: "Cloud AI", icon: "☁️" },
  { value: "Ollama", label: "Ollama", hint: "Local AI", icon: "🖥️" },
];

const THEME_STORAGE_KEY = "ui-theme";

function getInitialTheme() {
  const existingTheme = document.documentElement.dataset.theme;
  if (existingTheme === "light" || existingTheme === "dark") {
    return existingTheme;
  }

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function isBotPath(pathname) {
  return pathname.startsWith("/homework-bot") || pathname.startsWith("/chat-bot");
}

/* ── SVG Icons ─────────────────────────────────────────── */

function ChevronDownIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function SettingsIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function Navbar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { clearSession } = useSession();
  const [theme, setTheme] = useState(getInitialTheme);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isBotsMenuOpen, setIsBotsMenuOpen] = useState(false);
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const botsMenuRef = useRef(null);
  const botsTriggerRef = useRef(null);
  const botsItemRefs = useRef([]);
  const providerMenuRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsBotsMenuOpen(false);
    setIsProviderMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (botsMenuRef.current && !botsMenuRef.current.contains(event.target)) {
        setIsBotsMenuOpen(false);
      }
      if (providerMenuRef.current && !providerMenuRef.current.contains(event.target)) {
        setIsProviderMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsBotsMenuOpen(false);
        setIsProviderMenuOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleThemeToggle = () => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  };

  const openBotsMenu = (focusIndex = null) => {
    setIsBotsMenuOpen(true);
    if (typeof focusIndex === "number") {
      requestAnimationFrame(() => {
        botsItemRefs.current[focusIndex]?.focus();
      });
    }
  };

  const closeBotsMenu = (restoreTriggerFocus = false) => {
    setIsBotsMenuOpen(false);
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => {
        botsTriggerRef.current?.focus();
      });
    }
  };

  const handleBotsMenuKeyDown = (event) => {
    const items = botsItemRefs.current.filter(Boolean);
    if (!items.length) {
      return;
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement);

    if (event.key === "Escape") {
      event.preventDefault();
      closeBotsMenu(true);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      items[nextIndex]?.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const isDarkTheme = theme === "dark";
  const userLabel = user?.name?.trim() || user?.email?.trim() || "Learner";
  const activeOnBotRoute = useMemo(() => isBotPath(location.pathname), [location.pathname]);
  const [aiProvider, setAiProvider] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("aiProvider") : null;
    return saved || "Gemini";
  });

  const handleProviderChange = (newProvider) => {
    setAiProvider(newProvider);
    if (typeof window !== "undefined") {
      localStorage.setItem("aiProvider", newProvider);
    }
    window.dispatchEvent(new Event("ai-provider-change"));
    setIsProviderMenuOpen(false);
  };

  const handleLogout = () => {
    clearSession();
    logout();
    setIsMobileMenuOpen(false);
    setIsBotsMenuOpen(false);
  };

  const currentProvider = providerOptions.find((p) => p.value === aiProvider) || providerOptions[0];

  return (
    <>
      <header className="site-nav sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <Link to="/studio" className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <BrandMarkIcon className="brand-mark-icon" />
            </span>
            <span>
              <span className="brand-title font-display">brainbyts</span>
              <span className="brand-subtitle">Smart lecture studio</span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <nav className="nav-shell hidden md:flex" aria-label="Primary">
              {primaryNavItems.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {({ isActive }) => (
                    <motion.span
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.98 }}
                      className={`nav-item ${isActive ? "nav-item-active" : "nav-item-idle"}`}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </NavLink>
              ))}

              <div
                ref={botsMenuRef}
                className="nav-bots-wrap"
              >
                <button
                  ref={botsTriggerRef}
                  type="button"
                  className={`nav-item nav-bots-trigger ${activeOnBotRoute ? "nav-item-active" : "nav-item-idle"}`}
                  aria-expanded={isBotsMenuOpen}
                  aria-haspopup="menu"
                  aria-controls="bots-menu"
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      openBotsMenu(0);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      openBotsMenu(botNavItems.length - 1);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeBotsMenu();
                    }
                  }}
                  onClick={() => setIsBotsMenuOpen((prev) => !prev)}
                >
                  Bots
                  <ChevronDownIcon className={`nav-bots-chevron ${isBotsMenuOpen ? "nav-bots-chevron-open" : ""}`} />
                </button>
                <AnimatePresence>
                  {isBotsMenuOpen && (
                    <motion.div
                      id="bots-menu"
                      className="nav-bots-menu"
                      role="menu"
                      aria-label="Bots"
                      onKeyDown={handleBotsMenuKeyDown}
                      initial={{ opacity: 0, y: -6, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.99 }}
                      transition={{ duration: 0.15 }}
                    >
                      {botNavItems.map((item, index) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          role="menuitem"
                          className="nav-bots-link"
                          onClick={() => closeBotsMenu()}
                          ref={(node) => {
                            botsItemRefs.current[index] = node;
                          }}
                        >
                          {({ isActive }) => (
                            <span className={`nav-bots-link-inner ${isActive ? "nav-bots-link-active" : ""}`}>
                              <span className="nav-bots-link-title">{item.label}</span>
                              <span className="nav-bots-link-hint">{item.hint}</span>
                            </span>
                          )}
                        </NavLink>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </nav>

            {/* ── AI Provider Custom Dropdown ─────────────────── */}
            <div ref={providerMenuRef} className="provider-dropdown-wrap">
              <button
                type="button"
                className="provider-dropdown-trigger"
                onClick={() => setIsProviderMenuOpen((prev) => !prev)}
                aria-expanded={isProviderMenuOpen}
                aria-haspopup="listbox"
              >
                <span className="provider-dropdown-icon">{currentProvider.icon}</span>
                <span className="provider-dropdown-label">{currentProvider.label}</span>
                <ChevronDownIcon className={`provider-dropdown-chevron ${isProviderMenuOpen ? "provider-dropdown-chevron-open" : ""}`} />
              </button>
              <AnimatePresence>
                {isProviderMenuOpen && (
                  <motion.div
                    className="provider-dropdown-menu"
                    role="listbox"
                    aria-label="AI Provider"
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.99 }}
                    transition={{ duration: 0.15 }}
                  >
                    {providerOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={aiProvider === option.value}
                        className={`provider-dropdown-option ${aiProvider === option.value ? "provider-dropdown-option-active" : ""}`}
                        onClick={() => handleProviderChange(option.value)}
                      >
                        <span className="provider-dropdown-option-icon">{option.icon}</span>
                        <span className="provider-dropdown-option-text">
                          <span className="provider-dropdown-option-label">{option.label}</span>
                          <span className="provider-dropdown-option-hint">{option.hint}</span>
                        </span>
                        {aiProvider === option.value && (
                          <svg viewBox="0 0 20 20" fill="currentColor" className="provider-dropdown-check">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {aiProvider === "Ollama" && <OllamaSetup />}

            <button
              type="button"
              className="theme-toggle"
              onClick={handleThemeToggle}
              aria-label={`Switch to ${isDarkTheme ? "light" : "dark"} theme`}
            >
              <span className="theme-toggle-icon" aria-hidden="true">
                {isDarkTheme ? (
                  <svg viewBox="0 0 24 24" fill="none" className="h-full w-full">
                    <path
                      d="M12 4.75v2.5m0 9.5v2.5m5.12-12.62-1.77 1.77M8.65 15.35l-1.77 1.77m10.37 0-1.77-1.77M8.65 8.65 6.88 6.88M19.25 12h-2.5m-9.5 0h-2.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="12" r="3.35" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" className="h-full w-full">
                    <path
                      d="M20 15.5A8.5 8.5 0 1 1 8.5 4a7 7 0 0 0 11.5 11.5Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </button>

            {/* Settings gear button */}
            <button
              type="button"
              className="settings-gear-btn"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Open settings"
            >
              <SettingsIcon className="settings-gear-icon" />
            </button>

            <button
              type="button"
              className="nav-mobile-toggle md:hidden"
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-nav-menu"
            >
              {isMobileMenuOpen ? "Close" : "Menu"}
            </button>

            {user && (
              <>
                <div className="user-chip hidden sm:inline-flex" title={user.name}>
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="user-chip-avatar" />
                  ) : (
                    <span className="user-chip-avatar user-chip-avatar-fallback">{userLabel.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="user-chip-name">{userLabel}</span>
                </div>
                <button type="button" className="logout-btn hidden sm:inline-flex" onClick={handleLogout}>
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>

        {isMobileMenuOpen && (
          <div id="mobile-nav-menu" className="mobile-nav-panel md:hidden">
            <nav className="mobile-nav-stack" aria-label="Mobile Navigation">
              {primaryNavItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `mobile-nav-link ${isActive ? "mobile-nav-link-active" : ""}`}>
                  {item.label}
                </NavLink>
              ))}
              <p className="mobile-nav-section">Bots</p>
              {botNavItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `mobile-nav-link ${isActive ? "mobile-nav-link-active" : ""}`}>
                  <span>{item.label}</span>
                  <span className="mobile-nav-hint">{item.hint}</span>
                </NavLink>
              ))}
              {user && (
                <div className="mobile-user-card">
                  <p className="mobile-nav-section">Account</p>
                  <div className="mobile-user-row">
                    {user.picture ? (
                      <img src={user.picture} alt={user.name} className="user-chip-avatar" />
                    ) : (
                      <span className="user-chip-avatar user-chip-avatar-fallback">{userLabel.slice(0, 1).toUpperCase()}</span>
                    )}
                    <div>
                      <p className="mobile-user-name">{user.name}</p>
                      <p className="mobile-user-email">{user.email}</p>
                    </div>
                  </div>
                  <button type="button" className="logout-btn w-full justify-center" onClick={handleLogout}>
                    Sign out
                  </button>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}

export default Navbar;
