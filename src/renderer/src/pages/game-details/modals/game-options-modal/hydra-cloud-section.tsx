import { useTranslation } from "react-i18next";

import type { CloudSaveProvider, LibraryGame, UserPreferences } from "@types";
import { CloudSyncPanel } from "../../cloud-sync/cloud-sync-panel";
import { CloudSavesSettingsSection } from "./cloud-saves-section";
import { useUserDetails } from "@renderer/hooks";

interface HydraCloudSettingsSectionProps {
  game: LibraryGame;
  automaticCloudSync: boolean;
  selectedCloudSaveProvider: CloudSaveProvider | null;
  userPreferences: UserPreferences | null;
  onToggleAutomaticCloudSync: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
  onChangeCloudSaveProvider: (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => Promise<void>;
}

export function HydraCloudSettingsSection({
  game,
  automaticCloudSync,
  selectedCloudSaveProvider,
  userPreferences,
  onToggleAutomaticCloudSync,
  onChangeCloudSaveProvider,
}: Readonly<HydraCloudSettingsSectionProps>) {
  const { t } = useTranslation("game_details");
  const { hasActiveSubscription } = useUserDetails();

  if (game.shop === "custom") {
    return (
      <p className="game-options-modal__category-note">
        {t("settings_not_available_for_custom_games")}
      </p>
    );
  }

  return (
    <div className="game-options-modal__cloud-panel">
      <CloudSavesSettingsSection
        selectedCloudSaveProvider={selectedCloudSaveProvider}
        hasHydraCloud={hasActiveSubscription}
        userPreferences={userPreferences}
        onChangeCloudSaveProvider={onChangeCloudSaveProvider}
      />
      <CloudSyncPanel
        automaticCloudSync={automaticCloudSync}
        selectedCloudSaveProvider={selectedCloudSaveProvider}
        userPreferences={userPreferences}
        onToggleAutomaticCloudSync={onToggleAutomaticCloudSync}
      />
    </div>
  );
}
