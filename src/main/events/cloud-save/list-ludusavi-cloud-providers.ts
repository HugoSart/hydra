import { Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";

const listLudusaviCloudProviders = async () => {
  return Ludusavi.listAvailableCloudProviders();
};

registerEvent("listLudusaviCloudProviders", listLudusaviCloudProviders);
