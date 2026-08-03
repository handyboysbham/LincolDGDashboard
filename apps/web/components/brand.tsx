import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="Lincoln Dirt and Gravel dashboard" className="brand" href="/">
      <span aria-hidden="true" className="brand-mark">
        LDG
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>Lincoln</strong>
          <span>Dirt &amp; Gravel</span>
        </span>
      )}
    </Link>
  );
}
