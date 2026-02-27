/**
 * Error Boundary — Catches React render errors gracefully.
 */
import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <Card className="w-full max-w-md animate-fade-in">
            <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-7 w-7 text-destructive" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-1">
                  Something went wrong
                </h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  An unexpected error occurred. Please try refreshing the page.
                </p>
              </div>
              {this.state.error && (
                <pre className="w-full overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground text-left max-h-32">
                  {this.state.error.message}
                </pre>
              )}
              <div className="flex gap-3">
                <Button variant="outline" onClick={this.handleGoHome} className="gap-2">
                  <Home className="h-4 w-4" />
                  Home
                </Button>
                <Button onClick={this.handleRetry} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
