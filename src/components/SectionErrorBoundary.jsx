import { Component } from "react";
import { styles } from "../theme/styles.js";

export default class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const name = this.props.name || "section";
    console.error(`[RenderError] ${name}`, error, info?.componentStack || info);
    this.props.onError?.(error, name);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return typeof this.props.fallback === "function"
          ? this.props.fallback(this.state.error)
          : this.props.fallback;
      }
      return (
        <div
          className="section-error-boundary"
          style={{ ...styles.compactPanel, borderColor: "#991b1b", marginTop: "8px" }}
          role="alert"
        >
          <strong style={{ color: "#fca5a5" }}>{this.props.name || "Section"} unavailable</strong>
          <p style={{ ...styles.compactFlags, margin: "4px 0 0" }}>
            {this.state.error?.message || "Render error — other sections still loading."}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
