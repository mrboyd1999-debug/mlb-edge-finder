import SectionErrorBoundary from "./components/SectionErrorBoundary.jsx";
import DFSPropsApp from "./DFSPropsApp";

const IS_DEV = import.meta.env.DEV;

function AppCrashFallback({ error }) {
  const message = error?.message || "Unknown error";
  const stack = error?.stack || "";
  return (
    <main style={{ padding: "16px", color: "#e2e8f0", background: "#0f172a", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>MLB Pick Finder</h1>
      <p style={{ margin: "0 0 12px", color: "#fcd34d" }}>
        Something went wrong loading the app. Refresh the page to try again.
      </p>
      {IS_DEV ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            border: "1px solid #991b1b",
            background: "#1e293b",
            fontSize: 12,
            lineHeight: 1.45,
          }}
          role="alert"
        >
          <strong style={{ color: "#fca5a5", display: "block", marginBottom: 8 }}>Dev error debug</strong>
          <p style={{ margin: "0 0 8px", color: "#fecaca", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
            {message}
          </p>
          {stack ? (
            <pre
              style={{
                margin: 0,
                maxHeight: 280,
                overflow: "auto",
                color: "#94a3b8",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {stack}
            </pre>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

export default function App() {
  return (
    <SectionErrorBoundary name="Application" fallback={(error) => <AppCrashFallback error={error} />}>
      <DFSPropsApp />
    </SectionErrorBoundary>
  );
}
