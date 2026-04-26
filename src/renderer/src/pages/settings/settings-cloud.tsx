import { useContext, useEffect, useState } from "react";
import {
  CheckCircleFillIcon,
  ChevronRightIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import { Button, Link } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import "./settings-cloud.scss";

const GOOGLE_DRIVE_URL = "https://drive.google.com";

export function SettingsCloud() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    setAccountEmail(userPreferences?.googleDriveAccountEmail ?? null);
    setIsCollapsed(!userPreferences?.googleDriveAccountEmail);
  }, [userPreferences]);

  const handleConnectGoogleDrive = async () => {
    setIsLoading(true);

    try {
      const result = await window.electron.authenticateGoogleDrive();

      await updateUserPreferences({
        googleDriveRefreshToken: result.refreshToken,
        googleDriveAccountEmail: result.accountEmail,
      });

      setAccountEmail(result.accountEmail);
      showSuccessToast("Google Drive connected", result.accountEmail);
    } catch (error) {
      showErrorToast(
        "Google Drive connection failed",
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectGoogleDrive = async () => {
    setIsLoading(true);

    try {
      await updateUserPreferences({
        googleDriveRefreshToken: null,
        googleDriveAccountEmail: null,
      });

      setAccountEmail(null);
      showSuccessToast("Google Drive disconnected");
    } catch (error) {
      showErrorToast(
        "Could not disconnect Google Drive",
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="settings-cloud">
      <p className="settings-cloud__description">
        Connect a cloud storage provider to keep your save backups available
        across devices.
      </p>

      <div
        className={`settings-cloud__section ${
          isCollapsed ? "" : "settings-cloud__section--expanded"
        }`}
      >
        <div className="settings-cloud__section-header">
          <button
            type="button"
            className="settings-cloud__collapse-button"
            onClick={() => setIsCollapsed((value) => !value)}
            aria-label={
              isCollapsed
                ? "Expand Google Drive section"
                : "Collapse Google Drive section"
            }
          >
            <span
              className={`settings-cloud__collapse-icon ${
                isCollapsed ? "" : "settings-cloud__collapse-icon--expanded"
              }`}
            >
              <ChevronRightIcon size={16} />
            </span>
          </button>
          <h3 className="settings-cloud__section-title">Google Drive</h3>
          {accountEmail && (
            <CheckCircleFillIcon
              size={16}
              className="settings-cloud__check-icon"
            />
          )}
        </div>

        {!isCollapsed && (
          <div className="settings-cloud__section-content">
            {accountEmail ? (
              <div className="settings-cloud__account">
                <span className="settings-cloud__account-label">
                  Connected as
                </span>
                <strong>{accountEmail}</strong>
              </div>
            ) : (
              <div className="settings-cloud__description-container">
                <p className="settings-cloud__provider-description">
                  Google Drive stores your save backups in your Google account
                  so you can restore them on other devices. Hydra only requests
                  access to its own app data.
                </p>
                <Link
                  to={GOOGLE_DRIVE_URL}
                  className="settings-cloud__create-account"
                >
                  <LinkExternalIcon />
                  Click here if you don't have a Google Drive account yet
                </Link>
              </div>
            )}

            <div className="settings-cloud__actions">
              {accountEmail ? (
                <Button
                  type="button"
                  theme="outline"
                  disabled={isLoading}
                  onClick={handleDisconnectGoogleDrive}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={isLoading}
                  onClick={handleConnectGoogleDrive}
                >
                  {isLoading ? "Connecting..." : "Connect Google Drive"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
