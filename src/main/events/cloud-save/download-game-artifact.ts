import { CloudSync } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const downloadGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string
) => {
  return CloudSync.downloadGameArtifact(objectId, shop, gameArtifactId);
};

registerEvent("downloadGameArtifact", downloadGameArtifact);
