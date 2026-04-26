import { useContext, useEffect, useState } from "react";
import {
  CheckCircleFillIcon,
  ChevronRightIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { GoogleDriveStorageMode } from "@types";
import "./settings-cloud.scss";

const GOOGLE_DRIVE_URL = "https://drive.google.com";
const DEFAULT_GOOGLE_DRIVE_STORAGE_MODE: GoogleDriveStorageMode = "appData";

const normalizeGoogleDrivePath = (value: string) =>
  value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");

const validateGoogleDrivePath = (value: string) => {
  const normalizedPath = normalizeGoogleDrivePath(value);

  if (!normalizedPath) {
    return "Enter a Google Drive path.";
  }

  if (value.includes("\\")) {
    return "Use forward slashes (/) in Google Drive paths.";
  }

  const segments = normalizedPath.split("/");

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "Path segments cannot be . or ..";
  }

  return null;
};

export function SettingsCloud() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<GoogleDriveStorageMode>(
    DEFAULT_GOOGLE_DRIVE_STORAGE_MODE
  );
  const [customPath, setCustomPath] = useState<string | null>(null);
  const [draftCustomPath, setDraftCustomPath] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [isSavingCustomPath, setIsSavingCustomPath] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    const nextAccountEmail = userPreferences?.googleDriveAccountEmail ?? null;
    setAccountEmail(nextAccountEmail);
  }, [userPreferences?.googleDriveAccountEmail]);

  useEffect(() => {
    setStorageMode(
      userPreferences?.googleDriveStorageMode ??
        DEFAULT_GOOGLE_DRIVE_STORAGE_MODE
    );
    const nextCustomPath = userPreferences?.googleDriveCustomPath ?? null;
    setCustomPath(nextCustomPath);
    setDraftCustomPath(nextCustomPath ?? "");
    setCustomPathError(null);
  }, [
    userPreferences?.googleDriveCustomPath,
    userPreferences?.googleDriveStorageMode,
  ]);

  const handleConnectGoogleDrive = async () => {
    if (isLoading) return;

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
    if (isLoading) return;

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

  const handleChangeStorageMode = async (nextMode: GoogleDriveStorageMode) => {
    setStorageMode(nextMode);

    await updateUserPreferences({
      googleDriveStorageMode: nextMode,
    });
  };

  const handleToggleCustomFolder = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    await handleChangeStorageMode(
      event.target.checked ? "customFolder" : "appData"
    );
  };

  const handleCustomPathChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setDraftCustomPath(event.target.value);
    if (customPathError) {
      setCustomPathError(null);
    }
  };

  const handleSaveCustomPath = async () => {
    const validationError = validateGoogleDrivePath(draftCustomPath);

    if (validationError) {
      setCustomPathError(validationError);
      return;
    }

    const normalizedPath = normalizeGoogleDrivePath(draftCustomPath);

    setIsSavingCustomPath(true);

    try {
      await updateUserPreferences({
        googleDriveCustomPath: normalizedPath,
      });

      setCustomPath(normalizedPath);
      setDraftCustomPath(normalizedPath);
      setCustomPathError(null);
      showSuccessToast("Google Drive path saved", normalizedPath);
    } catch (error) {
      showErrorToast(
        "Could not save Google Drive path",
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsSavingCustomPath(false);
    }
  };

  const normalizedDraftCustomPath = normalizeGoogleDrivePath(draftCustomPath);
  const hasPendingCustomPathChanges =
    normalizedDraftCustomPath !== (customPath ?? "");

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
                  Google Drive stores your save backups in your Google account.
                  You can keep them in Hydra&apos;s private app storage or point
                  sync to a custom Drive path.
                </p>
                <Link
                  to={GOOGLE_DRIVE_URL}
                  className="settings-cloud__create-account"
                >
                  <LinkExternalIcon />
                  Click here if you don&apos;t have a Google Drive account yet
                </Link>
              </div>
            )}

            <div className="settings-cloud__storage-options">
              <CheckboxField
                checked={storageMode === "customFolder"}
                onChange={handleToggleCustomFolder}
                disabled={isLoading}
                label={
                  <span className="settings-cloud__checkbox-label">
                    <strong>Use custom folder</strong>
                    <small>
                      Store backups in a Google Drive folder you choose. When
                      disabled, Hydra uses its private app storage.
                    </small>
                  </span>
                }
              />

              {storageMode === "customFolder" && (
                <TextField
                  label="Google Drive path"
                  value={draftCustomPath}
                  placeholder="Hydra/Backups"
                  onChange={handleCustomPathChange}
                  disabled={isLoading || isSavingCustomPath}
                  error={customPathError}
                  hint={
                    customPathError
                      ? null
                      : "Use folder names separated by /. Example: Hydra/Backups"
                  }
                  rightContent={
                    <Button
                      type="button"
                      theme="outline"
                      onClick={handleSaveCustomPath}
                      disabled={
                        isLoading ||
                        isSavingCustomPath ||
                        !draftCustomPath.trim() ||
                        !hasPendingCustomPathChanges
                      }
                    >
                      {isSavingCustomPath ? "Saving..." : "Save"}
                    </Button>
                  }
                />
              )}
            </div>

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
