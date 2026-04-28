import { SelectField } from "@renderer/components";
import {
  getConnectedExternalCloudProviders,
  getExternalCloudProviderLabel,
} from "@shared";
import type { CloudSaveProvider, UserPreferences } from "@types";

interface ConnectedCloudProviderOption {
  value: CloudSaveProvider;
  label: string;
}

interface CloudSavesSettingsSectionProps {
  selectedCloudSaveProvider: CloudSaveProvider | null;
  hasHydraCloud: boolean;
  userPreferences: UserPreferences | null;
  onChangeCloudSaveProvider: (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => Promise<void>;
}

const getConnectedCloudProviderOptions = (
  userPreferences: UserPreferences | null
): ConnectedCloudProviderOption[] => {
  return getConnectedExternalCloudProviders(userPreferences).map((provider) => {
    const accountEmail = userPreferences?.[provider.accountEmailKey];
    const accountLabel = typeof accountEmail === "string" ? accountEmail : null;

    return {
      value: provider.id,
      label: accountLabel
        ? `${provider.label} (${accountLabel})`
        : provider.label,
    };
  });
};

export function CloudSavesSettingsSection({
  selectedCloudSaveProvider,
  hasHydraCloud,
  userPreferences,
  onChangeCloudSaveProvider,
}: Readonly<CloudSavesSettingsSectionProps>) {
  const connectedProviders = getConnectedCloudProviderOptions(userPreferences);
  const isSelectedProviderConnected =
    !selectedCloudSaveProvider ||
    connectedProviders.some(
      (provider) => provider.value === selectedCloudSaveProvider
    );

  const options = [
    ...(hasHydraCloud ||
    !selectedCloudSaveProvider ||
    !isSelectedProviderConnected
      ? [
          {
            key: "none",
            value: "",
            label:
              hasHydraCloud && !selectedCloudSaveProvider
                ? "Hydra Cloud"
                : "No provider selected",
          },
        ]
      : []),
    ...connectedProviders.map((provider) => ({
      key: provider.value,
      value: provider.value,
      label: provider.label,
    })),
    ...(!isSelectedProviderConnected && selectedCloudSaveProvider
      ? [
          {
            key: `${selectedCloudSaveProvider}-disconnected`,
            value: selectedCloudSaveProvider,
            label: `${getExternalCloudProviderLabel(selectedCloudSaveProvider)} (disconnected)`,
          },
        ]
      : []),
  ];
  const canSelectProvider =
    hasHydraCloud ||
    connectedProviders.length > 0 ||
    !isSelectedProviderConnected;

  if (!canSelectProvider) {
    return null;
  }

  return (
    <div className="game-options-modal__cloud-saves">
      <div className="game-options-modal__panel-header">
        <h2>Cloud Saves</h2>
        <p>
          Choose which connected cloud provider this game should use for save
          sync.
        </p>
      </div>

      <div className="game-options-modal__section">
        <SelectField
          theme="dark"
          label="Cloud provider"
          value={selectedCloudSaveProvider ?? ""}
          options={options}
          onChange={onChangeCloudSaveProvider}
        />

        {!isSelectedProviderConnected && selectedCloudSaveProvider ? (
          <p className="game-options-modal__category-note">
            The previously selected provider is no longer connected. Choose a
            connected provider or clear the selection.
          </p>
        ) : (
          <p className="game-options-modal__category-note">
            Only cloud services connected in Settings &gt; Integrations are
            available here.
          </p>
        )}
      </div>
    </div>
  );
}
