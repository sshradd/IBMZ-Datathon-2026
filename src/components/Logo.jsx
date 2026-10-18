/** The Relit mark: a sun coming up over a red horizon line, power coming back. */
export default function Logo({ size = 28 }) {
  return (
    <span className="logo" aria-hidden>
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none" strokeLinecap="round" strokeWidth="5">
        <path d="M14 42a18 18 0 0 1 36 0" stroke="currentColor" />
        <path d="M32 20V12M17 27l-6-6M47 27l6-6" stroke="currentColor" />
        <path d="M10 49h44" stroke="#e5594d" />
      </svg>
    </span>
  );
}
