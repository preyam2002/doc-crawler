'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-svh flex items-center justify-center px-6 bg-background">
      <div className="text-center max-w-sm">
        <h2 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h2>
        <p className="text-sm text-muted-foreground/60 mb-6 leading-relaxed">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2.5 text-sm font-medium rounded-xl bg-foreground text-background hover:bg-foreground/80 transition-colors cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
