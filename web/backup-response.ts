export async function readBackupResponse(response: Response): Promise<Blob> {
  if (!response.ok) {
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const error = await response.json().catch(() => null);
      if (typeof error?.message === "string") throw new Error(error.message);
    }
    throw new Error(
      `Backup download interrupted (HTTP ${response.status}). No backup file was downloaded. Wait a minute and try again; if it repeats, report this error.`,
    );
  }
  const file = await response.blob();
  if (await file.slice(0, 8).text() !== "PZBACK01")
    throw new Error("The server did not return a valid encrypted backup. No backup file was downloaded. Please try again.");
  return file;
}
