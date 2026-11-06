export type MasterKind =
  "customers" | "sites" | "brands" | "rates" | "rules" | "items";

// Coordinator master access is limited to the operational records authorised by management.
export function canWriteMaster(
  role: string,
  kind: MasterKind,
  id: string,
): boolean {
  return (
    role === "Admin" ||
    (role === "Coordinator" &&
      (kind === "customers" ||
        kind === "sites" ||
        kind === "rates" ||
        kind === "items"))
  );
}
