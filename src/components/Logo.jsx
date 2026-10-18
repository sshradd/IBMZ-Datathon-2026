/** The Surge mark: an S that is also a power surge, on an orange disc. */
export default function Logo({ size = 28 }) {
  return (
    <span className="logo" aria-hidden>
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M45 14H26L19 33h21l-9 17H17" />
      </svg>
    </span>
  );
}
