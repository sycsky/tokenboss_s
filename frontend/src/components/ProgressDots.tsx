/**
 * Three-dot onboarding progress indicator. `current` is 1-indexed.
 */
export function ProgressDots({ current, total = 3 }: { current: number; total?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: total }, (_, i) => {
        const isActive = i + 1 === current;
        const isPast = i + 1 < current;
        return (
          <span
            key={i}
            className={[
              "h-1.5 rounded-full transition-all",
              isActive ? "w-6 bg-accent" : isPast ? "w-1.5 bg-accent" : "w-1.5 bg-border",
            ].join(" ")}
          />
        );
      })}
      <span className="ml-2 text-caption text-text-muted">
        {current}/{total}
      </span>
    </div>
  );
}
