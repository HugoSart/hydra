import { SelectField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const hydraCloudProviderId = "hydra-cloud";

const cloudProviderLabels: Record<string, string> = {
  box: "Box",
  dropbox: "Dropbox",
  [hydraCloudProviderId]: "Hydra Cloud",
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
};

const waitForCloudProviderConnection = async (
  providerId: string,
  setupPromise: Promise<void>
) => {
  const timeoutMs = 120_000;
  const startedAt = Date.now();

  return new Promise<void>((resolve, reject) => {
    const interval = window.setInterval(async () => {
      try {
        const currentProvider =
          await window.electron.getCurrentLudusaviCloudProvider();

        if (currentProvider === providerId) {
          window.clearInterval(interval);
          resolve();
        } else if (Date.now() - startedAt > timeoutMs) {
          window.clearInterval(interval);
          reject(new Error("Timed out waiting for Ludusavi cloud auth"));
        }
      } catch (err) {
        window.clearInterval(interval);
        reject(err);
      }
    }, 1_500);

    setupPromise
      .then(async () => {
        const currentProvider =
          await window.electron.getCurrentLudusaviCloudProvider();

        window.clearInterval(interval);

        if (currentProvider === providerId) {
          resolve();
        } else {
          reject(new Error("Ludusavi cloud auth did not complete"));
        }
      })
      .catch((err) => {
        window.clearInterval(interval);
        reject(err);
      });
  });
};

export function SettingsCloudSaves() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { hasActiveSubscription } = useUserDetails();
  const { showErrorToast, showSuccessToast } = useToast();

  const [availableCloudProviderIds, setAvailableCloudProviderIds] = useState<
    string[]
  >([]);
  const [currentCloudProviderId, setCurrentCloudProviderId] = useState<
    string | null
  >(null);
  const [selectedCloudProviderId, setSelectedCloudProviderId] =
    useState(hydraCloudProviderId);
  const [isSavingCloudProvider, setIsSavingCloudProvider] = useState(false);
  const [cloudPath, setCloudPath] = useState("ludusavi-backup");
  const [savedCloudPath, setSavedCloudPath] = useState("ludusavi-backup");
  const [isSavingCloudPath, setIsSavingCloudPath] = useState(false);
  const [isRcloneAvailable, setIsRcloneAvailable] = useState<boolean | null>(
    null
  );

  const savedCloudProviderId =
    userPreferences?.cloudSaveProvider ?? hydraCloudProviderId;

  useEffect(() => {
    let isMounted = true;

    window.electron
      .isRcloneAvailable()
      .then((available) => {
        if (isMounted) {
          setIsRcloneAvailable(available);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsRcloneAvailable(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isRcloneAvailable) return undefined;

    let isMounted = true;

    Promise.all([
      window.electron.listLudusaviCloudProviders(),
      window.electron.getCurrentLudusaviCloudProvider(),
      window.electron.getLudusaviCloudPath(),
    ]).then(([providers, currentProvider, currentCloudPath]) => {
      if (!isMounted) return;

      setAvailableCloudProviderIds(providers);
      setCurrentCloudProviderId(currentProvider);
      setCloudPath(currentCloudPath);
      setSavedCloudPath(currentCloudPath);
    });

    return () => {
      isMounted = false;
    };
  }, [isRcloneAvailable]);

  useEffect(() => {
    setSelectedCloudProviderId(savedCloudProviderId);
  }, [savedCloudProviderId]);

  const cloudProviderOptions = useMemo(
    () => [
      {
        key: hydraCloudProviderId,
        value: hydraCloudProviderId,
        label: cloudProviderLabels[hydraCloudProviderId],
      },
      ...availableCloudProviderIds.map((providerId) => {
        const label = cloudProviderLabels[providerId] ?? providerId;
        const connectedLabel =
          providerId === currentCloudProviderId ? " \u2713" : "";

        return {
          key: providerId,
          value: providerId,
          label: `${label}${connectedLabel}`,
        };
      }),
    ],
    [availableCloudProviderIds, currentCloudProviderId]
  );

  const shouldShowHydraCloudMessage =
    selectedCloudProviderId === hydraCloudProviderId && !hasActiveSubscription;

  const shouldShowCloudPathInput =
    selectedCloudProviderId !== hydraCloudProviderId;

  const handleCloudProviderChange = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const nextProviderId = event.target.value;
    const previousProviderId = selectedCloudProviderId;

    setSelectedCloudProviderId(nextProviderId);
    setIsSavingCloudProvider(true);

    try {
      const latestCurrentProvider =
        await window.electron.getCurrentLudusaviCloudProvider();

      setCurrentCloudProviderId(latestCurrentProvider);

      if (nextProviderId === hydraCloudProviderId) {
        if (latestCurrentProvider) {
          await window.electron.clearLudusaviCloudProvider();
        }
      } else if (nextProviderId !== latestCurrentProvider) {
        const setupPromise =
          window.electron.setLudusaviCloudProvider(nextProviderId);

        await waitForCloudProviderConnection(nextProviderId, setupPromise);
      }

      await updateUserPreferences({ cloudSaveProvider: nextProviderId });
      setCurrentCloudProviderId(
        nextProviderId === hydraCloudProviderId ? null : nextProviderId
      );
      showSuccessToast(t("changes_saved"));
    } catch (err) {
      logger.error("Failed to update cloud save provider", err);
      setSelectedCloudProviderId(previousProviderId);
      showErrorToast("Failed to update cloud save provider");
    } finally {
      setIsSavingCloudProvider(false);
    }
  };

  const saveCloudPath = async () => {
    const trimmedCloudPath = cloudPath.trim();

    if (!trimmedCloudPath) {
      setCloudPath(savedCloudPath);
      return;
    }

    if (trimmedCloudPath === savedCloudPath) {
      setCloudPath(trimmedCloudPath);
      return;
    }

    setIsSavingCloudPath(true);

    try {
      await window.electron.setLudusaviCloudPath(trimmedCloudPath);
      setCloudPath(trimmedCloudPath);
      setSavedCloudPath(trimmedCloudPath);
      showSuccessToast(t("changes_saved"));
    } catch (err) {
      logger.error("Failed to update Ludusavi cloud path", err);
      setCloudPath(savedCloudPath);
      showErrorToast("Failed to update cloud folder");
    } finally {
      setIsSavingCloudPath(false);
    }
  };

  if (isRcloneAvailable === null) {
    return (
      <p
        style={{
          margin: 0,
          color: "var(--text-secondary)",
          lineHeight: 1.6,
        }}
      >
        Checking rclone availability...
      </p>
    );
  }

  if (!isRcloneAvailable) {
    return (
      <p
        style={{
          margin: 0,
          color: "var(--text-secondary)",
          lineHeight: 1.6,
        }}
      >
        rclone must be installed for external cloud saves to work. Check the{" "}
        <button
          type="button"
          style={{
            color: "var(--color-primary)",
            textDecoration: "underline",
            padding: 0,
            border: 0,
            background: "transparent",
            cursor: "pointer",
          }}
          onClick={() =>
            window.electron.openExternal("https://rclone.org/downloads/")
          }
        >
          rclone downloads
        </button>{" "}
        page for installation instructions.
      </p>
    );
  }

  return (
    <>
      <p
        style={{
          margin: "0 0 8px 0",
          color: "var(--text-secondary)",
          lineHeight: 1.6,
        }}
      >
        Choose where Hydra should keep your game save backups. Hydra Cloud uses
        your Hydra account, while external providers use Ludusavi&apos;s cloud
        integration.
      </p>

      <SelectField
        label="Cloud provider"
        value={selectedCloudProviderId}
        options={cloudProviderOptions}
        onChange={handleCloudProviderChange}
        disabled={isSavingCloudProvider}
      />

      {shouldShowHydraCloudMessage && (
        <small>
          Hydra Cloud requires an active subscription. {t("become_subscriber")}{" "}
          in {t("account")} & {t("privacy")}.
        </small>
      )}

      {shouldShowCloudPathInput && (
        <TextField
          label="Cloud folder"
          value={cloudPath}
          disabled={isSavingCloudPath}
          hint="Folder inside the selected cloud provider where Ludusavi stores save backups."
          onChange={(event) => setCloudPath(event.target.value)}
          onBlur={saveCloudPath}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      )}
    </>
  );
}
