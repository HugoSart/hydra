import { CloudSync } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const getGameArtifacts = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  return CloudSync.getGameArtifacts(objectId, shop);
};

registerEvent("getGameArtifacts", getGameArtifacts);
