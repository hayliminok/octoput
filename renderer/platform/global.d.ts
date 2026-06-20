import type { GlazeAPI } from "../preload";

declare global {
  interface Window {
    glazeAPI: GlazeAPI;
  }
}

export {};
