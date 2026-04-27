/**
 * Slock-pixel button class helper. Filled fill + 2px ink border + 3px hard
 * offset shadow. Hover "depresses" — translates 1px to bottom-right and
 * shrinks the shadow. See docs/superpowers/design/2026-04-27-tokenboss-design-system.md §4.
 *
 *   primary   — terracotta fill, white text
 *   secondary — cream fill, ink text
 *   dark      — ink fill, white text
 */
export type SlockBtnVariant = 'primary' | 'secondary' | 'dark';

const base =
  'inline-block border-2 border-ink rounded-md font-bold tracking-tight ' +
  'px-5 py-2.5 md:px-6 md:py-3 text-[14px] md:text-[15px] ' +
  'shadow-[3px_3px_0_0_#1C1917] ' +
  'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
  'disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[3px_3px_0_0_#1C1917] disabled:cursor-not-allowed ' +
  'transition-all whitespace-nowrap';

export function slockBtn(variant: SlockBtnVariant = 'primary'): string {
  const fill =
    variant === 'primary'
      ? 'bg-accent text-white'
      : variant === 'dark'
        ? 'bg-ink text-white'
        : 'bg-bg text-ink';
  return `${base} ${fill}`;
}
