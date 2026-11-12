/**
 * Emblème de l'application (création originale) : un cercle partagé entre AKA (rouge) et AO (bleu),
 * traversé par une ceinture blanche nouée.
 */
export function Logo({ size = 40, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className="logo"
    >
      <defs>
        <clipPath id="logo-disc">
          <circle cx="32" cy="32" r="29" />
        </clipPath>
      </defs>
      <g clipPath="url(#logo-disc)">
        <rect x="0" y="0" width="30.5" height="64" fill="#e5383b" />
        <rect x="33.5" y="0" width="30.5" height="64" fill="#3b82f6" />
        <rect x="0" y="27" width="64" height="8" fill="#f1f3f5" />
      </g>
      <path d="M28.5 35 L24 51 L19.5 49 L26 35 Z" fill="#f1f3f5" stroke="#0e1115" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M35.5 35 L40 51 L44.5 49 L38 35 Z" fill="#f1f3f5" stroke="#0e1115" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="26.5" y="24.5" width="11" height="13" rx="2.5" fill="#f1f3f5" stroke="#0e1115" strokeWidth="1.5" />
    </svg>
  );
}

