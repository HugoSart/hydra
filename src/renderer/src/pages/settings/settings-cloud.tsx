import { useContext, useEffect, useState } from "react";
import {
  CheckCircleFillIcon,
  ChevronRightIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { CloudStorageMode, UserPreferences } from "@types";
import "./settings-cloud.scss";

const GOOGLE_DRIVE_URL = "https://drive.google.com";
const DROPBOX_URL = "https://www.dropbox.com";
const DEFAULT_CLOUD_STORAGE_MODE: CloudStorageMode = "appData";

const normalizeCloudPath = (value: string) =>
  value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");

const validateCloudPath = (providerName: string, value: string) => {
  const normalizedPath = normalizeCloudPath(value);

  if (!normalizedPath) {
    return `Enter a ${providerName} path.`;
  }

  if (value.includes("\\")) {
    return `Use forward slashes (/) in ${providerName} paths.`;
  }

  const segments = normalizedPath.split("/");

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "Path segments cannot be . or ..";
  }

  return null;
};

type CloudProviderConnection = {
  refreshToken: string;
  accountEmail: string;
};

type CloudProviderPreferenceKeys = {
  refreshToken: "googleDriveRefreshToken" | "dropboxRefreshToken";
  accountEmail: "googleDriveAccountEmail" | "dropboxAccountEmail";
  storageMode: "googleDriveStorageMode" | "dropboxStorageMode";
  customPath: "googleDriveCustomPath" | "dropboxCustomPath";
};

interface CloudProviderSectionProps {
  providerName: string;
  providerUrl: string;
  providerDescription: string;
  appStorageDescription: string;
  pathLabel: string;
  pathPlaceholder: string;
  preferenceKeys: CloudProviderPreferenceKeys;
  userPreferences: UserPreferences | null;
  updateUserPreferences: (
    preferences: Partial<UserPreferences>
  ) => Promise<void>;
  authenticate: () => Promise<CloudProviderConnection>;
  showSuccessToast: (title: string, message?: string) => void;
  showErrorToast: (title: string, message?: string) => void;
}

function CloudProviderSection({
  providerName,
  providerUrl,
  providerDescription,
  appStorageDescription,
  pathLabel,
  pathPlaceholder,
  preferenceKeys,
  userPreferences,
  updateUserPreferences,
  authenticate,
  showSuccessToast,
  showErrorToast,
}: Readonly<CloudProviderSectionProps>) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<CloudStorageMode>(
    DEFAULT_CLOUD_STORAGE_MODE
  );
  const [customPath, setCustomPath] = useState<string | null>(null);
  const [draftCustomPath, setDraftCustomPath] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [isSavingCustomPath, setIsSavingCustomPath] = useState(false);

  useEffect(() => {
    const nextAccountEmail =
      (userPreferences?.[preferenceKeys.accountEmail] as string | null) ?? null;
    setAccountEmail(nextAccountEmail);
  }, [preferenceKeys.accountEmail, userPreferences]);

  useEffect(() => {
    const nextStorageMode =
      (userPreferences?.[preferenceKeys.storageMode] as CloudStorageMode) ??
      DEFAULT_CLOUD_STORAGE_MODE;
    const nextCustomPath =
      (userPreferences?.[preferenceKeys.customPath] as string | null) ?? null;

    setStorageMode(nextStorageMode);
    setCustomPath(nextCustomPath);
    setDraftCustomPath(nextCustomPath ?? "");
    setCustomPathError(null);
  }, [preferenceKeys.customPath, preferenceKeys.storageMode, userPreferences]);

  const handleConnect = async () => {
    if (isLoading) return;

    setIsLoading(true);

    try {
      const result = await authenticate();

      await updateUserPreferences({
        [preferenceKeys.refreshToken]: result.refreshToken,
        [preferenceKeys.accountEmail]: result.accountEmail,
      } as Partial<UserPreferences>);

      setAccountEmail(result.accountEmail);
      showSuccessToast(`${providerName} connected`, result.accountEmail);
    } catch (error) {
      showErrorToast(
        `${providerName} connection failed`,
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (isLoading) return;

    setIsLoading(true);

    try {
      await updateUserPreferences({
        [preferenceKeys.refreshToken]: null,
        [preferenceKeys.accountEmail]: null,
      } as Partial<UserPreferences>);

      setAccountEmail(null);
      showSuccessToast(`${providerName} disconnected`);
    } catch (error) {
      showErrorToast(
        `Could not disconnect ${providerName}`,
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangeStorageMode = async (nextMode: CloudStorageMode) => {
    setStorageMode(nextMode);

    await updateUserPreferences({
      [preferenceKeys.storageMode]: nextMode,
    } as Partial<UserPreferences>);
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
    const validationError = validateCloudPath(providerName, draftCustomPath);

    if (validationError) {
      setCustomPathError(validationError);
      return;
    }

    const normalizedPath = normalizeCloudPath(draftCustomPath);

    setIsSavingCustomPath(true);

    try {
      await updateUserPreferences({
        [preferenceKeys.customPath]: normalizedPath,
      } as Partial<UserPreferences>);

      setCustomPath(normalizedPath);
      setDraftCustomPath(normalizedPath);
      setCustomPathError(null);
      showSuccessToast(`${providerName} path saved`, normalizedPath);
    } catch (error) {
      showErrorToast(
        `Could not save ${providerName} path`,
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsSavingCustomPath(false);
    }
  };

  const normalizedDraftCustomPath = normalizeCloudPath(draftCustomPath);
  const hasPendingCustomPathChanges =
    normalizedDraftCustomPath !== (customPath ?? "");

  return (
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
              ? `Expand ${providerName} section`
              : `Collapse ${providerName} section`
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
        <h3 className="settings-cloud__section-title">{providerName}</h3>
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
                {providerDescription}
              </p>
              <Link to={providerUrl} className="settings-cloud__create-account">
                <LinkExternalIcon />
                Click here if you don&apos;t have a {providerName} account yet
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
                  <small>{appStorageDescription}</small>
                </span>
              }
            />

            {storageMode === "customFolder" && (
              <TextField
                label={pathLabel}
                value={draftCustomPath}
                placeholder={pathPlaceholder}
                onChange={handleCustomPathChange}
                disabled={isLoading || isSavingCustomPath}
                error={customPathError}
                hint={
                  customPathError
                    ? null
                    : `Use folder names separated by /. Example: ${pathPlaceholder}`
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
                onClick={handleDisconnect}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                type="button"
                disabled={isLoading}
                onClick={handleConnect}
              >
                {isLoading ? "Connecting..." : `Connect ${providerName}`}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsCloud() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  return (
    <div className="settings-cloud">
      <p className="settings-cloud__description">
        Connect a cloud storage provider to keep your save backups available
        across devices.
      </p>

      <CloudProviderSection
        providerName="Google Drive"
        providerUrl={GOOGLE_DRIVE_URL}
        providerDescription="Google Drive stores your save backups in your Google account. You can keep them in Hydra's private app storage or point sync to a custom Drive path."
        appStorageDescription="Store backups in a Google Drive folder you choose. When disabled, Hydra uses its private app storage."
        pathLabel="Google Drive path"
        pathPlaceholder="Hydra/Backups"
        preferenceKeys={{
          refreshToken: "googleDriveRefreshToken",
          accountEmail: "googleDriveAccountEmail",
          storageMode: "googleDriveStorageMode",
          customPath: "googleDriveCustomPath",
        }}
        userPreferences={userPreferences}
        updateUserPreferences={updateUserPreferences}
        authenticate={() => window.electron.authenticateGoogleDrive()}
        showSuccessToast={showSuccessToast}
        showErrorToast={showErrorToast}
      />

      <CloudProviderSection
        providerName="Dropbox"
        providerUrl={DROPBOX_URL}
        providerDescription="Dropbox stores your save backups in your Dropbox account. You can keep them in Hydra's default Dropbox location or point sync to a custom Dropbox path."
        appStorageDescription="Store backups in a Dropbox folder you choose. When disabled, Hydra uses its default Dropbox location."
        pathLabel="Dropbox path"
        pathPlaceholder="Hydra/Backups"
        preferenceKeys={{
          refreshToken: "dropboxRefreshToken",
          accountEmail: "dropboxAccountEmail",
          storageMode: "dropboxStorageMode",
          customPath: "dropboxCustomPath",
        }}
        userPreferences={userPreferences}
        updateUserPreferences={updateUserPreferences}
        authenticate={() => window.electron.authenticateDropbox()}
        showSuccessToast={showSuccessToast}
        showErrorToast={showErrorToast}
      />
    </div>
  );
}
