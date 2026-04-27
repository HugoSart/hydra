import { CloudSync } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const deleteGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string
) => {
  return CloudSync.deleteGameArtifact(objectId, shop, gameArtifactId);
};

registerEvent("deleteGameArtifact", deleteGameArtifact);
