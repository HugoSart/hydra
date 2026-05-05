import { useTranslation } from "react-i18next";
import { SettingsCloudSaves } from "./settings-cloud-saves";
import { SettingsDebrid } from "./settings-debrid";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("cloud_saves_experimental")}</h3>
        <SettingsCloudSaves />
      </div>
    </div>
  );
}
