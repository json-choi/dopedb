// Generated from assets/brand/dopedb-icon.svg by pnpm icons; do not edit.
// Hook-free shared SVG: each app passes its own React useId() for isolated masks.
// Mask black/white values encode opacity; visible artwork inherits currentColor.
// Source SHA-256: 804415ac636780dc19fc899bcc8c31513eef9aeb52aa9ff7af94ae5c5e43c6a3
export function DopeDBMarkGraphic({
  instanceId,
  className,
  size = 28,
}: {
  instanceId: string;
  className?: string;
  size?: number;
}) {
  const prefix = `dopedb-${instanceId.replace(/:/g, "")}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-dopedb-mark="orbital"
    >
      <defs>
        <path id={`${prefix}-body`} d="M7.5 8.5H17.0625C21.3975 8.5 24.5 11.78 24.5 16S21.3975 23.5 17.0625 23.5H7.5Z" />
        <path id={`${prefix}-front`} d="M2.7 16A13.3 3.8 0 0 0 29.3 16" transform="rotate(-24 16 16)" />
        <mask id={`${prefix}-back-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="white" />
          <use href={`#${prefix}-body`} fill="black" stroke="black" strokeWidth="2.5" />
        </mask>
        <mask id={`${prefix}-front-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="white" />
          <use href={`#${prefix}-front`} stroke="black" strokeWidth="2.5" />
          <circle cx="27.296" cy="13.05" r="2.6" fill="black" />
        </mask>
      </defs>
      <path d="M2.7 16A13.3 3.8 0 0 1 29.3 16" transform="rotate(-24 16 16)" stroke="currentColor" strokeWidth="1.05" mask={`url(#${prefix}-back-mask)`} />
      <g mask={`url(#${prefix}-front-mask)`} stroke="currentColor" strokeWidth="1.5">
        <use href={`#${prefix}-body`} />
        <path d="M7.5 13H17.7M7.5 18H15.15" />
      </g>
      <use href={`#${prefix}-front`} stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" />
      <circle cx="27.296" cy="13.05" r="1.85" fill="currentColor" />
    </svg>
  );
}
