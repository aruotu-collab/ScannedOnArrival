import { backupFileName, downloadBackup, type BackupFile } from "./backup";

export function backupShareFile(backup: BackupFile): File {
  return new File([JSON.stringify(backup)], backupFileName(), { type: "application/json" });
}

export function canShareBackup(): boolean {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    const probe = new File(["{}"], backupFileName(), { type: "application/json" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function sendBackupToAnotherPhone(backup: BackupFile): Promise<"shared" | "downloaded"> {
  const file = backupShareFile(backup);
  if (canShareBackup()) {
    await navigator.share({
      files: [file],
      title: "ScannedOnArrival index",
      text: "On the other phone, open ScannedOnArrival and Receive this file.",
    });
    return "shared";
  }
  downloadBackup(backup);
  return "downloaded";
}
