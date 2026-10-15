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
  confirmLabel = "Confirm and send",
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
    cancel.className = "pz-button pz-button--neutral";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = confirmLabel;
    confirm.className = "pz-button pz-button--primary";
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

/** Explicitly choose one of two financial proposals; cancellation leaves records unchanged. */
export function confirmDiscountProposal(proposals: Array<{ key: "discount" | "margin"; label: string; discount: string; payable: string }>): Promise<"discount" | "margin" | null> {
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog");
    dialog.className = "revision-confirmation master-dialog";
    dialog.setAttribute("aria-label", "Select discount order proposal");
    const title = document.createElement("h2"); title.textContent = "Select one discount proposal";
    const detail = document.createElement("p"); detail.textContent = "Select exactly one discount proposal to send to Atif for quotation revision. The saved quotation remains unchanged.";
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = "Send"; confirm.className = "primary"; confirm.disabled = true;
    let chosen: "discount" | "margin" | null = null;
    const inputs: HTMLInputElement[] = [];
    dialog.append(title, detail);
    for (const proposal of proposals) {
      const label = document.createElement("label");
      const input = document.createElement("input"); input.type = "checkbox"; input.setAttribute("aria-label", proposal.label);
      input.onchange = () => {
        chosen = input.checked ? proposal.key : null;
        for (const other of inputs) if (other !== input) other.checked = false;
        confirm.disabled = chosen === null;
      };
      inputs.push(input);
      label.append(input, document.createTextNode(`${proposal.label} · Discount PKR ${proposal.discount} · Payable PKR ${proposal.payable}`));
      dialog.append(label);
    }
    const finish = (answer: typeof chosen) => { dialog.close(); dialog.remove(); previous?.focus(); resolve(answer); };
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.onclick = () => finish(null);
    confirm.onclick = () => { if (chosen) finish(chosen); };
    dialog.addEventListener("cancel", e => { e.preventDefault(); finish(null); });
    const actions = document.createElement("div"); actions.className = "dialog-actions"; actions.append(cancel, confirm); dialog.append(actions);
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}
