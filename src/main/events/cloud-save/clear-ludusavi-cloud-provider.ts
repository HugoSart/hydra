import { Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";

const clearLudusaviCloudProvider = async () => {
  return Ludusavi.clearCloudProvider();
};

registerEvent("clearLudusaviCloudProvider", clearLudusaviCloudProvider);
