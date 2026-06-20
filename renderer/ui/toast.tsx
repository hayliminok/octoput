import * as React from "react";
import { Toaster as SonnerToaster, toast } from "sonner";

import { useTheme } from "./hooks/use-theme";

/**
 * sonner's Toaster, wired to the app theme. Without an explicit `theme`, sonner
 * defaults to light and ignores the user's dark/light choice.
 */
export function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  const { theme } = useTheme();
  return <SonnerToaster {...props} theme={theme} />;
}

export { toast };
