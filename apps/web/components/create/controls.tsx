import type { ButtonHTMLAttributes, ReactNode } from "react";

export function PrimaryButton(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type">) {
  return (
    <button
      type="button"
      className="inline-flex h-12 w-full items-center justify-center rounded-full bg-accent px-6 text-base font-semibold text-on-accent shadow-card transition-transform active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
      {...props}
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-r2 border border-down p-3 text-sm text-down [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}
