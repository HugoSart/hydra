import { Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";

const getLudusaviCloudPath = async () => {
  return Ludusavi.getCloudPath();
};

registerEvent("getLudusaviCloudPath", getLudusaviCloudPath);
