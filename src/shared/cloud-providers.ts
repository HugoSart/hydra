import type { CloudSaveProvider, UserPreferences } from "@types";

export interface CloudProviderMetadata {
  id: CloudSaveProvider;
  label: string;
  refreshTokenKey: keyof UserPreferences;
  accountEmailKey: keyof UserPreferences;
}

export const EXTERNAL_CLOUD_PROVIDER_METADATA = [
  {
    id: "googleDrive",
    label: "Google Drive",
    refreshTokenKey: "googleDriveRefreshToken",
    accountEmailKey: "googleDriveAccountEmail",
  },
  {
    id: "dropbox",
    label: "Dropbox",
    refreshTokenKey: "dropboxRefreshToken",
    accountEmailKey: "dropboxAccountEmail",
  },
] as const satisfies readonly CloudProviderMetadata[];

export const getExternalCloudProviderMetadata = (id: CloudSaveProvider) =>
  EXTERNAL_CLOUD_PROVIDER_METADATA.find((provider) => provider.id === id);

export const getExternalCloudProviderLabel = (id: CloudSaveProvider) =>
  getExternalCloudProviderMetadata(id)?.label ?? id;

export const getConnectedExternalCloudProviders = (
  userPreferences: UserPreferences | null
) =>
  EXTERNAL_CLOUD_PROVIDER_METADATA.filter((provider) => {
    const refreshToken = userPreferences?.[provider.refreshTokenKey];
    return typeof refreshToken === "string" && refreshToken.length > 0;
  });
