import { Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";

const setLudusaviCloudProvider = async (
  _event: Electron.IpcMainInvokeEvent,
  providerId: string
) => {
  return Ludusavi.setCloudProvider(providerId);
};

registerEvent("setLudusaviCloudProvider", setLudusaviCloudProvider);
