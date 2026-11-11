import { useEffect } from "react";

const navigationEvent = "power-zone:before-workspace-navigation";

// After "Leave" is chosen, other handlers of the same Back press or click do not ask again.
let leaveChosen = false;
// One decision per navigation, even when several mounted editors are dirty.
export function confirmLeaveWorkspace() {
  if (leaveChosen) return true;
  const event = new Event(navigationEvent, { cancelable: true });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) return true;
  const leave = window.confirm(
    "You have unsaved changes. Leave this page and discard them?",
  );
  if (leave) { leaveChosen = true; setTimeout(() => { leaveChosen = false; }, 0); }
  return leave;
}

export function useUnsavedChanges(dirty: boolean, protectReload=true) {
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: Event) => event.preventDefault();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener(navigationEvent, prevent);
    if(protectReload)window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener(navigationEvent, prevent);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty,protectReload]);
}
