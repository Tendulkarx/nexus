import { Button } from "./primitives";

interface ErrorBoundaryViewProps {
  error?: unknown;
  reset?: () => void;
}

/** Route-level error fallback. */
export function ErrorBoundaryView({ error, reset }: ErrorBoundaryViewProps) {
  const message = error instanceof Error ? error.message : String(error ?? "Something went wrong");
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-semibold text-primary">Something went wrong</p>
      <p className="text-xs text-secondary max-w-sm">{message}</p>
      {reset && (
        <Button variant="accent" onClick={reset}>
          Try again
        </Button>
      )}
    </div>
  );
}
