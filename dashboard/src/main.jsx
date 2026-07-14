import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { ThemeProvider } from "./context/ThemeContext";
import { bootstrapApiBase, normalizeApiBase, getStoredApiUrl, preloadIceServers } from "./api/apiBase";

// Prefer local Vite /api proxy on this PC. Keep tunnel env for phones / remote only.
if (typeof window !== "undefined") {
  try {
    const host = window.location.hostname;
    const onLocal = host === "localhost" || host === "127.0.0.1";
    if (onLocal && import.meta.env.DEV) {
      localStorage.removeItem("dp_api_url");
    } else {
      const envUrl = import.meta.env.VITE_API_BASE_URL?.trim();
      if (envUrl) {
        const normalizedEnv = normalizeApiBase(envUrl);
        const stored = getStoredApiUrl();
        if (stored && normalizeApiBase(stored) !== normalizedEnv) {
          localStorage.removeItem("dp_api_url");
        }
      } else if (import.meta.env.DEV) {
        localStorage.removeItem("dp_api_url");
      }
    }
  } catch {}
}

bootstrapApiBase()
  .then(() => preloadIceServers())
  .finally(() => {
    ReactDOM.createRoot(document.getElementById("root")).render(
      <React.StrictMode>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </React.StrictMode>,
    );
  });
