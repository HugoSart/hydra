import { Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";

const listLudusaviGameBackups = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  _shop: GameShop
) => {
  return Ludusavi.listGameBackups(objectId);
};

registerEvent("listLudusaviGameBackups", listLudusaviGameBackups);
