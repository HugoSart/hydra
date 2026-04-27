import { CloudSync } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const renameGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string,
  label: string
) => {
  return CloudSync.renameGameArtifact(objectId, shop, gameArtifactId, label);
};

registerEvent("renameGameArtifact", renameGameArtifact);
