import { CloudSync } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const toggleGameArtifactFreeze = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string,
  freeze: boolean
) => {
  return CloudSync.toggleGameArtifactFreeze(
    objectId,
    shop,
    gameArtifactId,
    freeze
  );
};

registerEvent("toggleGameArtifactFreeze", toggleGameArtifactFreeze);
