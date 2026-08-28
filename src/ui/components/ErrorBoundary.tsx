import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Rendered instead of the children when something throws. Receives the
   * error and a `retry` that clears the boundary — enough for a dialog to
   * offer "try again" without reloading the page and losing the plan.
   */
  fallback: (error: Error, retry: () => void) => ReactNode;
  /** Called once per capture, so a caller can close the thing that failed. */
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Stops one broken thing from taking the whole editor with it.
 *
 * Without a boundary, React unmounts the entire tree on any render error,
 * and the project — which lives in memory, not on a server — goes with
 * it. The case that actually bit: the dialogs are code-split, so a chunk
 * request that fails (a stale build, a dropped connection, a proxy) throws
 * inside `Suspense` and blanks the app. Losing an afternoon's plan because
 * a menu entry couldn't be fetched is not an acceptable failure.
 *
 * A class component because this is the one thing hooks still cannot do.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The stack is the only trace of what happened — this app has no
    // server to report to, so the console is where a user can be asked to
    // look, and where the diagnostic report points.
    console.error("KL — erreur non rattrapée", error, info.componentStack);
    this.props.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  private readonly retry = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    return error ? this.props.fallback(error, this.retry) : this.props.children;
  }
}

/** The whole-editor fallback: the plan is gone from the screen, so say what to do rather than showing a stack. */
export function AppErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="app-error" role="alert">
      <h1>L’éditeur s’est arrêté</h1>
      <p>
        Une erreur inattendue a interrompu l’application. Votre projet est enregistré
        automatiquement dans ce navigateur : rouvrez la page pour reprendre à la dernière
        sauvegarde.
      </p>
      <p className="app-error__detail">{error.message}</p>
      <div className="app-error__actions">
        <button type="button" onClick={onRetry}>
          Réessayer sans recharger
        </button>
        <button type="button" onClick={() => window.location.reload()}>
          Recharger la page
        </button>
      </div>
    </div>
  );
}

/** The dialog fallback: the editor behind is intact, so this only has to explain and get out of the way. */
export function DialogErrorFallback({
  error,
  onRetry,
  onClose,
}: {
  error: Error;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2>Cette fenêtre n’a pas pu s’ouvrir</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <p>
          Le plan reste ouvert et intact. Si l’application vient d’être mise à jour, rechargez la
          page pour récupérer la version la plus récente.
        </p>
        <p className="app-error__detail">{error.message}</p>
        <div className="dialog__actions">
          <button type="button" onClick={onRetry}>
            Réessayer
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Recharger la page
          </button>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  );
}
