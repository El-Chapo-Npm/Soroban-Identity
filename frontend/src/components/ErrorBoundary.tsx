import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="container">
        <div className="card" role="alert">
          <h2>Something went wrong</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
            The app hit an unexpected error. You can try again or reload the page.
          </p>
          <details style={{ marginBottom: "1rem" }}>
            <summary>Error details</summary>
            <pre className="result">{error.message}{error.stack ? `\n\n${error.stack}` : ""}</pre>
          </details>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={this.reset}>Try again</button>
            <button onClick={() => window.location.reload()}>Reload page</button>
          </div>
        </div>
      </div>
    );
  }
}
