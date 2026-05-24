import SectionErrorBoundary from "./components/SectionErrorBoundary.jsx";
import DFSPropsApp from "./DFSPropsApp";

export default function App() {
  return (
    <SectionErrorBoundary
      name="Application"
      fallback={
        <main style={{ padding: "16px", color: "#e2e8f0", background: "#0f172a", minHeight: "100vh" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>MLB Pick Finder</h1>
          <p style={{ margin: 0, color: "#fcd34d" }}>
            Something went wrong loading the app. Refresh the page to try again.
          </p>
        </main>
      }
    >
      <DFSPropsApp />
    </SectionErrorBoundary>
  );
}
