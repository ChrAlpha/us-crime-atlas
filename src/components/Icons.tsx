import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconFrame({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  );
}

export function AtlasIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4.5 6.5 9 4l6 2.5L19.5 4v13.5L15 20l-6-2.5L4.5 20V6.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M9 4v13.5M15 6.5V20" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <circle cx="12" cy="11" fill="currentColor" r="1.55" />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="10.8" cy="10.8" r="6.1" stroke="currentColor" strokeWidth="1.7" />
      <path d="m15.4 15.4 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconFrame>
  );
}

export function LocateIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </IconFrame>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </IconFrame>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M19.2 15.5A8 8 0 0 1 8.5 4.8 7.7 7.7 0 1 0 19.2 15.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </IconFrame>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 10.5v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <circle cx="12" cy="7.5" fill="currentColor" r="1" />
    </IconFrame>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M19 7.5V3.8l-2 2A7.8 7.8 0 1 0 19.7 13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M19 3.8h-3.7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconFrame>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M13.5 5H19v5.5M18.5 5.5l-8 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M17.5 13v4.2a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 17.2V8.3a1.8 1.8 0 0 1 1.8-1.8H11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconFrame>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconFrame>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 7h5M15 7h5M4 17h3M13 17h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <circle cx="12" cy="7" r="2.1" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="17" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    </IconFrame>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M10.5 4.4 3.7 17a1.7 1.7 0 0 0 1.5 2.5h13.6a1.7 1.7 0 0 0 1.5-2.5L13.5 4.4a1.7 1.7 0 0 0-3 0Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M12 9v4.3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <circle cx="12" cy="16.4" fill="currentColor" r=".95" />
    </IconFrame>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m4.2 9 7.8-4.2L19.8 9 12 13.2 4.2 9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="m5.1 13.2 6.9 3.7 6.9-3.7M5.1 16.3 12 20l6.9-3.7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </IconFrame>
  );
}
