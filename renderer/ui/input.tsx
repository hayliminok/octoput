import * as React from "react";
import { cn } from "./utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-7 w-full rounded-md border border-gray-a6 bg-card px-2.5 text-[0.8125rem] text-foreground shadow-sm transition-colors dark:shadow-none",
          "placeholder:text-gray-a10 focus-visible:border-blue-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-a6",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "[&::-webkit-search-cancel-button]:appearance-none",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
