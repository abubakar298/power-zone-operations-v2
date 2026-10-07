/** Confirm document transitions before any request or local mutation occurs. */
export function confirmTransition(action: string, detail: string): boolean {
  return window.confirm(
    `${action}?\n\n${detail}\n\nChoose OK to continue or Cancel to leave the document unchanged.`,
  );
}

/** In-app confirmation avoids native browser modal focus problems in embedded browsers. */
export function confirmRevision(
  action: string,
  detail: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog");
    dialog.className = "revision-confirmation master-dialog";
    dialog.setAttribute("aria-label", action);
    const title = document.createElement("h2");
    title.textContent = action;
    const text = document.createElement("p");
    text.textContent = detail;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = "Confirm and send";
    confirm.className = "primary";
    const finish = (answer: boolean) => {
      dialog.close();
      dialog.remove();
      previous?.focus();
      resolve(answer);
    };
    cancel.onclick = () => finish(false);
    confirm.onclick = () => finish(true);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(false);
    });
    actions.append(cancel, confirm);
    dialog.append(title, text, actions);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
