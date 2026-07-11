import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { bootstrapApiBase, normalizeApiBase, getStoredApiUrl, preloadIceServers } from "./api/apiBase";

// Prefer the configured public/tunnel API over a stale saved LAN URL.
if (typeof window !== "undefined") {
  try {
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
  } catch {}
}

bootstrapApiBase()
  .then(() => preloadIceServers())
  .finally(() => {
    ReactDOM.createRoot(document.getElementById("root")).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
