import { Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";

const setLudusaviCloudPath = async (
  _event: Electron.IpcMainInvokeEvent,
  cloudPath: string
) => {
  return Ludusavi.setCloudPath(cloudPath);
};

registerEvent("setLudusaviCloudPath", setLudusaviCloudPath);
