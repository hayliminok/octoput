import { Button } from "./button";

export interface ErrorBoundaryViewProps {
  error: Error;
  reset?: () => void;
}

/** Router error fallback. */
export function ErrorBoundaryView({ error, reset }: ErrorBoundaryViewProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="drag-region fixed left-0 right-0 top-0 h-13" />
      <h1 className="text-title2">Something went wrong</h1>
      <p className="max-w-md text-callout text-gray-a10">{error.message}</p>
      {reset ? (
        <Button variant="filled" onClick={reset}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
