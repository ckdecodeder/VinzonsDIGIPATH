import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { bootstrapApiBase } from "./api/apiBase";

// During local development, prefer the env / tunnel URL over any saved value.
if (typeof window !== "undefined" && import.meta.env.DEV) {
  try {
    localStorage.removeItem("dp_api_url");
  } catch {}
}

bootstrapApiBase().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
