import { Component, useEffect, type ReactNode } from "react";
export class ApplicationBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    document.documentElement.dataset.applicationState = "failed";
  }
  render() {
    if (this.state.failed)
      return (
        <main role="alert">
          <h1>The dashboard could not be displayed</h1>
          <p>
            Please reload the page. If the problem continues, contact Morris
            Interactive.
          </p>
          <button onClick={() => location.reload()}>Reload page</button>
        </main>
      );
    return this.props.children;
  }
}
export function ApplicationReady() {
  useEffect(() => {
    document.documentElement.dataset.applicationState = "ready";
    window.dispatchEvent(new Event("mi:application-ready"));
  }, []);
  return null;
}
