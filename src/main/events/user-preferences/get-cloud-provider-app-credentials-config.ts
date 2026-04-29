import { getCloudProviderAppCredentialsConfig } from "@main/services/cloud/cloud-provider-app-credentials";
import { registerEvent } from "../register-event";

const getCloudProviderAppCredentialsConfigEvent = async () =>
  getCloudProviderAppCredentialsConfig();

registerEvent(
  "getCloudProviderAppCredentialsConfig",
  getCloudProviderAppCredentialsConfigEvent
);
