import { logger } from "../logger.js";

export const appHandlers = {
  getInfo: async () => {
    logger.info("app", "App info requested");
    return {
      name: "Nexus",
      version: "1.0.0",
      environment: process.env.NODE_ENV || "production",
    };
  },
};
