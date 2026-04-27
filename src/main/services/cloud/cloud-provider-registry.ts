import {
  EXTERNAL_CLOUD_PROVIDER_METADATA,
  getExternalCloudProviderMetadata,
} from "@shared";
import type { CloudSaveProvider, UserPreferences } from "@types";
import type { CloudProviderDefinition } from "./cloud-provider-strategy";
import { dropboxProviderStrategy } from "./dropbox";
import { googleDriveProviderStrategy } from "./google-drive";

const strategiesByProviderId = {
  googleDrive: googleDriveProviderStrategy,
  dropbox: dropboxProviderStrategy,
} satisfies Record<CloudSaveProvider, CloudProviderDefinition["strategy"]>;

export const CLOUD_PROVIDER_DEFINITIONS = EXTERNAL_CLOUD_PROVIDER_METADATA.map(
  (metadata) => ({
    id: metadata.id,
    label: metadata.label,
    disconnectedErrorMessage: `${metadata.label} is not connected`,
    strategy: strategiesByProviderId[metadata.id],
    getRefreshToken: (userPreferences: UserPreferences | null) => {
      const refreshToken = userPreferences?.[metadata.refreshTokenKey];
      return typeof refreshToken === "string" ? refreshToken : null;
    },
  })
) satisfies CloudProviderDefinition[];

export const getCloudProviderDefinition = (id: CloudSaveProvider) => {
  const definition = CLOUD_PROVIDER_DEFINITIONS.find(
    (provider) => provider.id === id
  );

  if (!definition) {
    const metadata = getExternalCloudProviderMetadata(id);
    throw new Error(
      metadata
        ? `${metadata.label} is missing a cloud sync strategy`
        : `Unknown cloud provider: ${id}`
    );
  }

  return definition;
};
