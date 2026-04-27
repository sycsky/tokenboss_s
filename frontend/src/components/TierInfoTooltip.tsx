export function TierInfoTooltip({ extras }: { extras: string[] }) {
  if (!extras || extras.length === 0) return null;
  return (
    <button
      type="button"
      className="group relative w-[30px] h-[30px] rounded-md border border-border-2 bg-surface text-ink-3 font-serif italic font-semibold flex items-center justify-center cursor-help"
      aria-label="详情"
    >
      i
      <span className="hidden group-hover:block absolute bottom-full right-0 mb-2 bg-ink text-bg text-[11.5px] font-medium leading-snug px-3.5 py-2 rounded-md whitespace-nowrap shadow-xl z-10 font-sans not-italic">
        {extras.join(' · ')}
      </span>
    </button>
  );
}
