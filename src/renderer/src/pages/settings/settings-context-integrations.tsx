import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsCloud } from "@renderer/pages/settings/settings-cloud";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>
      <div className="settings-context-panel__group">
        <h3>Cloud services (REPLACE)</h3>
        <SettingsCloud />
      </div>
    </div>
  );
}
