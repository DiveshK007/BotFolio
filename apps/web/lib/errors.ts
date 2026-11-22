/** An expected failure in the create flow. `message` is plain words and is shown to the user. */
export class FlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FlowError";
  }
}

/** What to show for any thrown value. Unexpected errors are never shown raw. */
export function userMessage(e: unknown): string {
  return e instanceof FlowError ? e.message : "Something went wrong. Please try again.";
}
