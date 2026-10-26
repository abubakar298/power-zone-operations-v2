import { Component, type ReactNode } from "react";

/** A failed lazy download or unexpected render must not leave a blank portal. */
export class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="card" role="alert">
          <h2>This workspace could not be opened</h2>
          <p>
            Reload the page to reconnect. Previously saved documents are
            retained.
          </p>
          <button onClick={() => window.location.reload()}>Reload page</button>
        </section>
      );
    return this.props.children;
  }
}
