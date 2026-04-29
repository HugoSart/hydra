import type { CloudSaveProvider, UserPreferences } from "@types";
import type { CloudStorageMode } from "@types";

export interface CloudProviderAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface CloudProviderAuthenticationResult {
  refreshToken: string;
  accountEmail: string;
  clientSecret: string | null;
}

export interface CloudProviderAppCredentialsConfig {
  id: CloudSaveProvider;
  hasEnvAppCredentials: boolean;
}

export interface CloudProviderMetadata {
  id: CloudSaveProvider;
  label: string;
  clientIdKey: "googleDriveClientId" | "dropboxAppKey";
  clientSecretKey: "googleDriveClientSecret" | "dropboxAppSecret";
  clientIdLabel: string;
  clientSecretLabel: string;
  refreshTokenKey: "googleDriveRefreshToken" | "dropboxRefreshToken";
  accountEmailKey: "googleDriveAccountEmail" | "dropboxAccountEmail";
  storageModeKey: "googleDriveStorageMode" | "dropboxStorageMode";
  customPathKey: "googleDriveCustomPath" | "dropboxCustomPath";
  authenticateMethod: "authenticateGoogleDrive" | "authenticateDropbox";
  accountUrl: string;
  appSetupUrl: string;
  appSetupLinkLabel: string;
  appSetupDescription: string;
  requiredPermissions: string[];
  providerDescription: string;
  appStorageDescription: string;
  pathLabel: string;
  pathPlaceholder: string;
}

export const EXTERNAL_CLOUD_PROVIDER_METADATA = [
  {
    id: "googleDrive",
    label: "Google Drive",
    clientIdKey: "googleDriveClientId",
    clientSecretKey: "googleDriveClientSecret",
    clientIdLabel: "Client ID",
    clientSecretLabel: "Client secret",
    refreshTokenKey: "googleDriveRefreshToken",
    accountEmailKey: "googleDriveAccountEmail",
    storageModeKey: "googleDriveStorageMode",
    customPathKey: "googleDriveCustomPath",
    authenticateMethod: "authenticateGoogleDrive",
    accountUrl: "https://drive.google.com",
    appSetupUrl: "https://support.google.com/cloud/answer/15549257?hl=en",
    appSetupLinkLabel: "Create a Google OAuth client",
    appSetupDescription:
      "Use your own Google Cloud OAuth client for this connection. Create a web client, add http://127.0.0.1:53682/oauth/google/callback as the redirect URI, then paste its client ID and secret here.",
    requiredPermissions: [
      "https://www.googleapis.com/auth/drive.appdata",
      "https://www.googleapis.com/auth/drive.file",
    ],
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
    clientIdKey: "dropboxAppKey",
    clientSecretKey: "dropboxAppSecret",
    clientIdLabel: "App key",
    clientSecretLabel: "App secret",
    refreshTokenKey: "dropboxRefreshToken",
    accountEmailKey: "dropboxAccountEmail",
    storageModeKey: "dropboxStorageMode",
    customPathKey: "dropboxCustomPath",
    authenticateMethod: "authenticateDropbox",
    accountUrl: "https://www.dropbox.com",
    appSetupUrl: "https://www.dropbox.com/developers/reference/getting-started",
    appSetupLinkLabel: "Create a Dropbox app",
    appSetupDescription:
      "Use your own Dropbox app for this connection. Create an app in the Dropbox developer console, add http://127.0.0.1:53683/oauth/dropbox/callback as the redirect URI, then paste its app key and secret here.",
    requiredPermissions: [
      "account_info.read",
      "files.metadata.read",
      "files.content.read",
      "files.content.write",
    ],
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
