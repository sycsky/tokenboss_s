import { useNavigate } from "react-router-dom";

/**
 * Top-left back chevron. Uses `navigate(-1)` so it works for any screen that
 * was reached by a previous navigation.
 */
export function BackButton({
  to,
  label,
  tone = "light",
}: {
  /** Optional explicit target. If omitted, goes back in history. */
  to?: string;
  /** Optional label shown next to the chevron. */
  label?: string;
  tone?: "light" | "dark";
}) {
  const navigate = useNavigate();
  const textClass =
    tone === "dark" ? "text-dk-text-secondary" : "text-text-secondary";
  const hoverClass =
    tone === "dark" ? "hover:text-dk-text-primary" : "hover:text-text-primary";

  const handleClick = () => {
    if (to) navigate(to);
    else navigate(-1);
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 text-label ${textClass} ${hoverClass} transition-colors`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M10 12L6 8l4-4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label ?? "返回"}
    </button>
  );
}
