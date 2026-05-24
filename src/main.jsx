import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return;

  if (!window.__dfsGlobalErrorHandlersInstalled) {
    window.__dfsGlobalErrorHandlersInstalled = true;

    window.addEventListener("error", (event) => {
      console.error("[GlobalError]", event.error || event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      console.error("[GlobalUnhandledRejection]", event.reason);
    });

    const previousOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      console.error("[window.onerror]", message, { source, lineno, colno, error });
      if (typeof previousOnError === "function") {
        return previousOnError(message, source, lineno, colno, error);
      }
      return false;
    };
  }
}

installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
