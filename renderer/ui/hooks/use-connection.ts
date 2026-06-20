/**
 * IPC connection state. Under Electron the renderer↔main bridge is always
 * available, so this resolves to a connected, error-free state. The shape mirrors
 * a query result (`{ connected, error }`) for the consumers in root-view.
 */
export function useConnection(): { connected: boolean; error: Error | null } {
  return { connected: true, error: null };
}
