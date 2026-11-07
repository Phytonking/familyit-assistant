import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const MicIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
  </svg>
);
export const MicOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 2l20 20M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7" />
    <path d="M19 10a7 7 0 0 1-1.2 3.9M5 10a7 7 0 0 0 11.2 5.6M12 17v5" />
  </svg>
);
export const CamIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M16 10l6-3v10l-6-3" />
  </svg>
);
export const CamOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 2l20 20M16 16v0a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M10 6h4a2 2 0 0 1 2 2v3l6-4v10" />
  </svg>
);
export const FlipIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
    <path d="M9 13a3 3 0 0 1 5.2-2M15 13a3 3 0 0 1-5.2 2M14 9v2h-2M10 17v-2h2" />
  </svg>
);
export const EyeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const PhoneOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 15.5c5-4.7 13-4.7 18 0l-2.2 2.5a1 1 0 0 1-1.3.2l-2.7-1.6a1 1 0 0 1-.5-.9v-2a12 12 0 0 0-4.6 0v2a1 1 0 0 1-.5.9l-2.7 1.6a1 1 0 0 1-1.3-.2z" />
  </svg>
);
export const PhoneIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
export const ChatIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
export const SendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
export const HandIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" />
  </svg>
);
