import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  componentDidUpdate(_props: unknown, prev: State): void {
    if (!prev.error && this.state.error) this.heading.current?.focus();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main role="alert" style={{ padding: 32, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a', background: '#fff', minHeight: '100%' }}>
        {/* Focus target so the failure is announced and keyboard focus is not left on a removed element. */}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <h1 ref={this.heading} tabIndex={-1} style={{ fontSize: 24 }}>
          Something went wrong
        </h1>
        <p style={{ color: '#4d4d4d' }}>
          The page hit an unexpected error. Try again, or restart the application if the problem continues.
        </p>
        {import.meta.env.DEV && (
          <pre
            // A scrollable region must be keyboard-focusable.
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label="Error details"
            style={{ background: '#f5f5f5', padding: 16, overflow: 'auto', fontSize: 12 }}
          >
            {error.stack ?? error.message}
          </pre>
        )}
        <button type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </main>
    );
  }
}
