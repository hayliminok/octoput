interface Environment {
  flavor: string;
  isDevelopment: boolean;
}

/**
 * App environment info. Shaped like a query result (`{ data, error }`) for the
 * consumers in root-view; `data` is always present under Electron.
 */
export function useEnvironment(): { data: Environment; error: Error | null } {
  const flavor =
    (window.glazeAPI as { buildFlavor?: string }).buildFlavor ?? "Production";
  return {
    data: { flavor, isDevelopment: import.meta.env.DEV },
    error: null,
  };
}
