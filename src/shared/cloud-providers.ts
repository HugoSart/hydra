import type { CloudSaveProvider, UserPreferences } from "@types";
import type { CloudStorageMode } from "@types";

export interface CloudProviderMetadata {
  id: CloudSaveProvider;
  label: string;
  refreshTokenKey: "googleDriveRefreshToken" | "dropboxRefreshToken";
  accountEmailKey: "googleDriveAccountEmail" | "dropboxAccountEmail";
  storageModeKey: "googleDriveStorageMode" | "dropboxStorageMode";
  customPathKey: "googleDriveCustomPath" | "dropboxCustomPath";
  authenticateMethod: "authenticateGoogleDrive" | "authenticateDropbox";
  accountUrl: string;
  providerDescription: string;
  appStorageDescription: string;
  pathLabel: string;
  pathPlaceholder: string;
}

export const EXTERNAL_CLOUD_PROVIDER_METADATA = [
  {
    id: "googleDrive",
    label: "Google Drive",
    refreshTokenKey: "googleDriveRefreshToken",
    accountEmailKey: "googleDriveAccountEmail",
    storageModeKey: "googleDriveStorageMode",
    customPathKey: "googleDriveCustomPath",
    authenticateMethod: "authenticateGoogleDrive",
    accountUrl: "https://drive.google.com",
    providerDescription:
      "Google Drive stores your save backups in your Google account. You can keep them in Hydra's private app storage or point sync to a custom Drive path.",
    appStorageDescription:
      "Store backups in a Google Drive folder you choose. When disabled, Hydra uses its private app storage.",
    pathLabel: "Google Drive path",
    pathPlaceholder: "Hydra/Backups",
  },
  {
    id: "dropbox",
    label: "Dropbox",
    refreshTokenKey: "dropboxRefreshToken",
    accountEmailKey: "dropboxAccountEmail",
    storageModeKey: "dropboxStorageMode",
    customPathKey: "dropboxCustomPath",
    authenticateMethod: "authenticateDropbox",
    accountUrl: "https://www.dropbox.com",
    providerDescription:
      "Dropbox stores your save backups in your Dropbox account. You can keep them in Hydra's default Dropbox location or point sync to a custom Dropbox path.",
    appStorageDescription:
      "Store backups in a Dropbox folder you choose. When disabled, Hydra uses its default Dropbox location.",
    pathLabel: "Dropbox path",
    pathPlaceholder: "Hydra/Backups",
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

export const getExternalCloudProviderStorageMode = (
  provider: CloudProviderMetadata,
  userPreferences: UserPreferences | null
): CloudStorageMode => userPreferences?.[provider.storageModeKey] ?? "appData";
