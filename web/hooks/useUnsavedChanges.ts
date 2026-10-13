import { useEffect } from "react";

const navigationEvent = "power-zone:before-workspace-navigation";

// One decision per navigation, even when several mounted editors are dirty.
export function confirmLeaveWorkspace() {
  const event = new Event(navigationEvent, { cancelable: true });
  window.dispatchEvent(event);
  return !event.defaultPrevented || window.confirm(
    "You have unsaved changes. Leave this page and discard them?",
  );
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
