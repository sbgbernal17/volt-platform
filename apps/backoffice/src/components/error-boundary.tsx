/**
 * Límite de errores de render. React 19 desmonta todo el árbol cuando un componente lanza
 * durante el render; con este límite, el error queda acotado a la página y se puede reintentar.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Al cambiar (p. ej. la ruta), el límite se reinicia. */
  resetKey: string;
  fallback: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    }
    return this.props.children;
  }
}
