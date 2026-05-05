import { Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";

const restoreLudusaviCloudBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  _shop: GameShop,
  backupName?: string
) => {
  await Ludusavi.downloadCloudBackups(objectId);
  await Ludusavi.restoreGame(objectId, backupName);
};

registerEvent("restoreLudusaviCloudBackup", restoreLudusaviCloudBackup);
