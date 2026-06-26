import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[0.8125rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-a7 disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        // macOS-style filled accent (the window's default button). Amber-9 is a
        // light fill, so text uses the dark accent foreground, not white.
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/80",
        accent:
          "bg-blue-9 text-primary-foreground shadow-sm hover:bg-blue-10 active:bg-blue-8",
        // Neutral "push button": white in light mode with a hairline ring + soft
        // shadow, like a standard AppKit button.
        filled:
          "bg-card text-gray-12 shadow-sm ring-1 ring-gray-a5 hover:bg-gray-a2 active:bg-gray-a3 dark:shadow-none",
        glass: "bg-gray-a3 text-gray-12 hover:bg-gray-a4 backdrop-blur",
        outline: "border border-input bg-transparent hover:bg-gray-a2 active:bg-gray-a3",
        ghost: "text-gray-a11 hover:bg-gray-a3 hover:text-gray-12",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/80",
      },
      size: {
        default: "h-7 px-3",
        sm: "h-6 gap-1 px-2 text-[0.75rem]",
        large: "h-8 px-4",
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Square icon-only button (overrides horizontal padding). */
  iconOnly?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, iconOnly = false, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          buttonVariants({ variant, size }),
          iconOnly && (size === "large" ? "size-8 px-0" : "size-7 px-0"),
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
