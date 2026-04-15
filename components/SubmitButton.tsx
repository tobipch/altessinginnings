"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "",
  pendingText,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-progress transition-opacity`}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <Spinner />
          <span>{pendingText ?? "Wird verarbeitet..."}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="animate-spin shrink-0"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="14 40"
        opacity="0.85"
      />
    </svg>
  );
}
