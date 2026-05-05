import { gamesSublevel, levelKeys } from "@main/level";
import { Ludusavi, Wine } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";

const uploadLudusaviCloudBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  await Ludusavi.backupGame(shop, objectId, null, effectiveWinePrefixPath);
  await Ludusavi.uploadCloudBackups(objectId);
};

registerEvent("uploadLudusaviCloudBackup", uploadLudusaviCloudBackup);
