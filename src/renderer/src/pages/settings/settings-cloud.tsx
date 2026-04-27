import { useContext, useEffect, useState } from "react";
import {
  CheckCircleFillIcon,
  ChevronRightIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import {
  EXTERNAL_CLOUD_PROVIDER_METADATA,
  getExternalCloudProviderStorageMode,
} from "@shared";
import type { CloudProviderMetadata } from "@shared";
import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { CloudStorageMode, UserPreferences } from "@types";
import "./settings-cloud.scss";

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

interface CloudProviderSectionProps {
  provider: CloudProviderMetadata;
  userPreferences: UserPreferences | null;
  updateUserPreferences: (
    preferences: Partial<UserPreferences>
  ) => Promise<void>;
  authenticate: () => Promise<CloudProviderConnection>;
  showSuccessToast: (title: string, message?: string) => void;
  showErrorToast: (title: string, message?: string) => void;
}

function CloudProviderSection({
  provider,
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
  const [isEditingCustomPath, setIsEditingCustomPath] = useState(false);

  useEffect(() => {
    const nextAccountEmail =
      (userPreferences?.[provider.accountEmailKey] as string | null) ?? null;
    setAccountEmail(nextAccountEmail);
  }, [provider.accountEmailKey, userPreferences]);

  useEffect(() => {
    const nextStorageMode = getExternalCloudProviderStorageMode(
      provider,
      userPreferences
    );
    const nextCustomPath =
      (userPreferences?.[provider.customPathKey] as string | null) ?? null;

    setStorageMode(nextStorageMode);
    setCustomPath(nextCustomPath);
    setDraftCustomPath(nextCustomPath ?? "");
    setCustomPathError(null);
    setIsEditingCustomPath(false);
  }, [provider, userPreferences]);

  const handleConnect = async () => {
    if (isLoading) return;

    setIsLoading(true);

    try {
      const result = await authenticate();

      await updateUserPreferences({
        [provider.refreshTokenKey]: result.refreshToken,
        [provider.accountEmailKey]: result.accountEmail,
      } as Partial<UserPreferences>);

      setAccountEmail(result.accountEmail);
      showSuccessToast(`${provider.label} connected`, result.accountEmail);
    } catch (error) {
      showErrorToast(
        `${provider.label} connection failed`,
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
        [provider.refreshTokenKey]: null,
        [provider.accountEmailKey]: null,
      } as Partial<UserPreferences>);

      setAccountEmail(null);
      showSuccessToast(`${provider.label} disconnected`);
    } catch (error) {
      showErrorToast(
        `Could not disconnect ${provider.label}`,
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangeStorageMode = async (nextMode: CloudStorageMode) => {
    setStorageMode(nextMode);

    await updateUserPreferences({
      [provider.storageModeKey]: nextMode,
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
    const validationError = validateCloudPath(provider.label, draftCustomPath);

    if (validationError) {
      setCustomPathError(validationError);
      return;
    }

    const normalizedPath = normalizeCloudPath(draftCustomPath);

    if (normalizedPath === (customPath ?? "")) {
      setDraftCustomPath(normalizedPath);
      setCustomPathError(null);
      setIsEditingCustomPath(false);
      return;
    }

    setIsSavingCustomPath(true);

    try {
      await updateUserPreferences({
        [provider.customPathKey]: normalizedPath,
      } as Partial<UserPreferences>);

      setCustomPath(normalizedPath);
      setDraftCustomPath(normalizedPath);
      setCustomPathError(null);
      setIsEditingCustomPath(false);
      showSuccessToast(`${provider.label} path saved`, normalizedPath);
    } catch (error) {
      showErrorToast(
        `Could not save ${provider.label} path`,
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsSavingCustomPath(false);
    }
  };

  const handleCustomPathAction = async () => {
    if (!isEditingCustomPath) {
      setIsEditingCustomPath(true);
      setCustomPathError(null);
      return;
    }

    await handleSaveCustomPath();
  };

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
              ? `Expand ${provider.label} section`
              : `Collapse ${provider.label} section`
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
        <h3 className="settings-cloud__section-title">{provider.label}</h3>
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
                {provider.providerDescription}
              </p>
              <Link
                to={provider.accountUrl}
                className="settings-cloud__create-account"
              >
                <LinkExternalIcon />
                Click here if you don&apos;t have a {provider.label} account yet
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
                  <small>{provider.appStorageDescription}</small>
                </span>
              }
            />

            {storageMode === "customFolder" && (
              <TextField
                label={provider.pathLabel}
                value={draftCustomPath}
                placeholder={provider.pathPlaceholder}
                onChange={handleCustomPathChange}
                readOnly={!isEditingCustomPath}
                disabled={
                  isLoading || isSavingCustomPath || !isEditingCustomPath
                }
                error={customPathError}
                hint={
                  customPathError
                    ? null
                    : `Use folder names separated by /. Example: ${provider.pathPlaceholder}`
                }
                rightContent={
                  <Button
                    type="button"
                    theme="outline"
                    onClick={handleCustomPathAction}
                    disabled={
                      isLoading ||
                      isSavingCustomPath ||
                      (isEditingCustomPath && !draftCustomPath.trim())
                    }
                  >
                    {isSavingCustomPath
                      ? "Saving..."
                      : isEditingCustomPath
                        ? "Save"
                        : "Edit"}
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
                {isLoading ? "Connecting..." : `Connect ${provider.label}`}
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

      {EXTERNAL_CLOUD_PROVIDER_METADATA.map((provider) => (
        <CloudProviderSection
          key={provider.id}
          provider={provider}
          userPreferences={userPreferences}
          updateUserPreferences={updateUserPreferences}
          authenticate={() => window.electron[provider.authenticateMethod]()}
          showSuccessToast={showSuccessToast}
          showErrorToast={showErrorToast}
        />
      ))}
    </div>
  );
}
