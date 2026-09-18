import type { NexusAPI } from "./preload";

declare global {
  interface Window {
    nexusAPI: NexusAPI;
  }
}

export {};
