/** Confirm document transitions before any request or local mutation occurs. */
export function confirmTransition(action: string, detail: string): boolean {
  return window.confirm(
    `${action}?\n\n${detail}\n\nChoose OK to continue or Cancel to leave the document unchanged.`,
  );
}
