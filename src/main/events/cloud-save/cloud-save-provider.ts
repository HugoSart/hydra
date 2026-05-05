import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

export const hydraCloudProviderId = "hydra-cloud";

export const getActiveCloudProviderId = async () => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  return userPreferences?.cloudSaveProvider ?? hydraCloudProviderId;
};

export const isHydraCloudProvider = (providerId: string) =>
  providerId === hydraCloudProviderId;
