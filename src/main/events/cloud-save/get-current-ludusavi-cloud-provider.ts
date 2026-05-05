import { Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";

const getCurrentLudusaviCloudProvider = async () => {
  return Ludusavi.getCurrentCloudProvider();
};

registerEvent(
  "getCurrentLudusaviCloudProvider",
  getCurrentLudusaviCloudProvider
);
