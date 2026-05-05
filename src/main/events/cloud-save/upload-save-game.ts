import { gamesSublevel, levelKeys } from "@main/level";
import {
  CloudSync,
  logger,
  Ludusavi,
  WindowManager,
  Wine,
} from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import {
  getActiveCloudProviderId,
  isHydraCloudProvider,
} from "./cloud-save-provider";

const uploadSaveGame = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  downloadOptionTitle: string | null
) => {
  const activeCloudProviderId = await getActiveCloudProviderId();

  if (!isHydraCloudProvider(activeCloudProviderId)) {
    try {
      const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
      const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
        game?.winePrefixPath,
        objectId
      );

      await Ludusavi.backupGame(shop, objectId, null, effectiveWinePrefixPath);
      await Ludusavi.uploadCloudBackups(objectId);

      WindowManager.mainWindow?.webContents.send(
        `on-upload-complete-${objectId}-${shop}`,
        true
      );
    } catch (err) {
      logger.error("Failed to upload save game to Ludusavi cloud", err);

      WindowManager.mainWindow?.webContents.send(
        `on-upload-complete-${objectId}-${shop}`,
        false
      );
    }

    return;
  }

  return CloudSync.uploadSaveGame(
    objectId,
    shop,
    downloadOptionTitle,
    CloudSync.getBackupLabel(false)
  );
};

registerEvent("uploadSaveGame", uploadSaveGame);
