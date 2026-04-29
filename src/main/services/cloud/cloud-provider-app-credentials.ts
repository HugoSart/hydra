import { EXTERNAL_CLOUD_PROVIDER_METADATA } from "@shared";
import type { CloudProviderAuthCredentials } from "@shared";
import type { CloudSaveProvider } from "@types";

const toEnvProviderId = (providerId: CloudSaveProvider) =>
  providerId.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

const getCloudProviderEnvValue = (
  providerId: CloudSaveProvider,
  suffix: "APP_ID" | "APP_SECRET" | "REDIRECT_URI"
) => {
  const envProviderId = toEnvProviderId(providerId);
  const envKey = `MAIN_VITE_CLOUD_SERVICE_${envProviderId}_${suffix}`;
  return (
    (import.meta.env as Record<string, string | undefined>)[envKey]?.trim() ??
    ""
  );
};

export const getCloudProviderEnvAppCredentials = (
  providerId: CloudSaveProvider
): CloudProviderAuthCredentials | null => {
  const clientId = getCloudProviderEnvValue(providerId, "APP_ID");
  const clientSecret = getCloudProviderEnvValue(providerId, "APP_SECRET");

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
};

export const hasCloudProviderEnvAppCredentials = (
  providerId: CloudSaveProvider
) => getCloudProviderEnvAppCredentials(providerId) !== null;

export const resolveCloudProviderAppCredentials = (
  providerId: CloudSaveProvider,
  credentials: CloudProviderAuthCredentials
): CloudProviderAuthCredentials => {
  return getCloudProviderEnvAppCredentials(providerId) ?? credentials;
};

export const resolveCloudProviderRedirectUri = (
  providerId: CloudSaveProvider,
  defaultRedirectUri: string
) => {
  return (
    getCloudProviderEnvValue(providerId, "REDIRECT_URI") || defaultRedirectUri
  );
};

export const getCloudProviderAppCredentialsConfig = () =>
  EXTERNAL_CLOUD_PROVIDER_METADATA.map((provider) => ({
    id: provider.id,
    hasEnvAppCredentials: hasCloudProviderEnvAppCredentials(provider.id),
  }));
