import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Circle } from "lucide-react";
import { cn } from "./utils";

export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, orientation, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex gap-3",
      orientation === "horizontal" ? "flex-row items-center" : "flex-col",
      className,
    )}
    {...props}
  />
));
RadioGroup.displayName = "RadioGroup";

export const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "aspect-square size-4 rounded-full border border-input text-blue-11 shadow-sm",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "data-[state=checked]:border-blue-11 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <Circle className="size-2.5 fill-blue-11 text-blue-11" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";
