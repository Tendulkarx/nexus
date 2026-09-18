/**
 * Small local logger with a consistent (`scope`, `message`, `fields?`) call shape.
 */
function tag(scope: string, message: string): string {
  return `[${scope}] ${message}`;
}

export const logger = {
  debug: (scope: string, message: string, fields?: unknown): void => {
    if (fields !== undefined) console.debug(tag(scope, message), fields);
    else console.debug(tag(scope, message));
  },
  info: (scope: string, message: string, fields?: unknown): void => {
    if (fields !== undefined) console.info(tag(scope, message), fields);
    else console.info(tag(scope, message));
  },
  warn: (scope: string, message: string, fields?: unknown): void => {
    if (fields !== undefined) console.warn(tag(scope, message), fields);
    else console.warn(tag(scope, message));
  },
  error: (scope: string, message: string, err?: unknown): void => {
    if (err !== undefined) console.error(tag(scope, message), err);
    else console.error(tag(scope, message));
  },
};
