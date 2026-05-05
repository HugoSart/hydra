import { useAppSelector, useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type {
  LudusaviBackup,
  GameArtifact,
  GameShop,
  LudusaviBackupEntry,
} from "@types";
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

export enum CloudSyncState {
  New,
  Different,
  Same,
  Unknown,
}

export interface CloudSyncContext {
  backupPreview: LudusaviBackup | null;
  artifacts: GameArtifact[];
  ludusaviBackups: LudusaviBackupEntry[];
  ludusaviBackupsUpdatedAt: Date | null;
  showCloudSyncFilesModal: boolean;
  backupState: CloudSyncState;
  downloadGameArtifact: (gameArtifactId: string) => Promise<void>;
  uploadSaveGame: (downloadOptionTitle: string | null) => Promise<void>;
  refreshLudusaviBackups: () => Promise<void>;
  uploadLudusaviCloudBackup: () => Promise<void>;
  restoreLudusaviCloudBackup: (backupName?: string) => Promise<void>;
  deleteGameArtifact: (gameArtifactId: string) => Promise<void>;
  setShowCloudSyncFilesModal: React.Dispatch<React.SetStateAction<boolean>>;
  getGameBackupPreview: () => Promise<void>;
  getGameArtifacts: () => Promise<void>;
  toggleArtifactFreeze: (
    gameArtifactId: string,
    freeze: boolean
  ) => Promise<void>;
  restoringBackup: boolean;
  uploadingBackup: boolean;
  refreshingLudusaviBackups: boolean;
  uploadingLudusaviBackup: boolean;
  restoringLudusaviBackup: boolean;
  isCloudSyncOperationRunning: boolean;
  loadingPreview: boolean;
  freezingArtifact: boolean;
}

export const cloudSyncContext = createContext<CloudSyncContext>({
  backupPreview: null,
  backupState: CloudSyncState.Unknown,
  downloadGameArtifact: async () => {},
  uploadSaveGame: async () => {},
  refreshLudusaviBackups: async () => {},
  uploadLudusaviCloudBackup: async () => {},
  restoreLudusaviCloudBackup: async () => {},
  artifacts: [],
  ludusaviBackups: [],
  ludusaviBackupsUpdatedAt: null,
  deleteGameArtifact: async () => {},
  showCloudSyncFilesModal: false,
  setShowCloudSyncFilesModal: () => {},
  getGameBackupPreview: async () => {},
  toggleArtifactFreeze: async () => {},
  getGameArtifacts: async () => {},
  restoringBackup: false,
  uploadingBackup: false,
  refreshingLudusaviBackups: false,
  uploadingLudusaviBackup: false,
  restoringLudusaviBackup: false,
  isCloudSyncOperationRunning: false,
  loadingPreview: false,
  freezingArtifact: false,
});

const { Provider } = cloudSyncContext;
export const { Consumer: CloudSyncContextConsumer } = cloudSyncContext;

export interface CloudSyncContextProviderProps {
  children: React.ReactNode;
  objectId: string;
  shop: GameShop;
}

const hydraCloudProviderId = "hydra-cloud";
const ludusaviBackupsCache = new Map<
  string,
  { backups: LudusaviBackupEntry[]; updatedAt: Date }
>();

type CloudSyncOperationState = {
  restoringBackup: boolean;
  uploadingBackup: boolean;
  refreshingLudusaviBackups: boolean;
  uploadingLudusaviBackup: boolean;
  restoringLudusaviBackup: boolean;
};

type CloudSyncOperationEntry = CloudSyncOperationState & {
  refreshLudusaviBackupsPromise: Promise<void> | null;
  uploadLudusaviBackupPromise: Promise<void> | null;
  restoreLudusaviBackupPromise: Promise<void> | null;
};

const defaultOperationState: CloudSyncOperationState = {
  restoringBackup: false,
  uploadingBackup: false,
  refreshingLudusaviBackups: false,
  uploadingLudusaviBackup: false,
  restoringLudusaviBackup: false,
};

const cloudSyncOperationStore = new Map<string, CloudSyncOperationEntry>();
const cloudSyncOperationListeners = new Map<
  string,
  Set<(state: CloudSyncOperationState) => void>
>();

const createOperationEntry = (): CloudSyncOperationEntry => ({
  ...defaultOperationState,
  refreshLudusaviBackupsPromise: null,
  uploadLudusaviBackupPromise: null,
  restoreLudusaviBackupPromise: null,
});

const getOperationEntry = (gameKey: string) => {
  const existingEntry = cloudSyncOperationStore.get(gameKey);

  if (existingEntry) {
    return existingEntry;
  }

  const entry = createOperationEntry();
  cloudSyncOperationStore.set(gameKey, entry);

  return entry;
};

const getOperationState = (gameKey: string): CloudSyncOperationState => {
  const entry = cloudSyncOperationStore.get(gameKey);

  if (!entry) {
    return defaultOperationState;
  }

  return {
    restoringBackup: entry.restoringBackup,
    uploadingBackup: entry.uploadingBackup,
    refreshingLudusaviBackups: entry.refreshingLudusaviBackups,
    uploadingLudusaviBackup: entry.uploadingLudusaviBackup,
    restoringLudusaviBackup: entry.restoringLudusaviBackup,
  };
};

const notifyOperationListeners = (gameKey: string) => {
  const listeners = cloudSyncOperationListeners.get(gameKey);

  if (!listeners) return;

  const state = getOperationState(gameKey);
  listeners.forEach((listener) => listener(state));
};

const updateOperationState = (
  gameKey: string,
  state: Partial<CloudSyncOperationState>
) => {
  Object.assign(getOperationEntry(gameKey), state);
  notifyOperationListeners(gameKey);
};

const subscribeToOperationState = (
  gameKey: string,
  listener: (state: CloudSyncOperationState) => void
) => {
  const listeners =
    cloudSyncOperationListeners.get(gameKey) ??
    new Set<(state: CloudSyncOperationState) => void>();

  listeners.add(listener);
  cloudSyncOperationListeners.set(gameKey, listeners);

  return () => {
    listeners.delete(listener);

    if (!listeners.size) {
      cloudSyncOperationListeners.delete(gameKey);
    }
  };
};

export function CloudSyncContextProvider({
  children,
  objectId,
  shop,
}: CloudSyncContextProviderProps) {
  const { t } = useTranslation("game_details");

  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [ludusaviBackups, setLudusaviBackups] = useState<LudusaviBackupEntry[]>(
    []
  );
  const [ludusaviBackupsUpdatedAt, setLudusaviBackupsUpdatedAt] =
    useState<Date | null>(null);
  const [backupPreview, setBackupPreview] = useState<LudusaviBackup | null>(
    null
  );
  const [showCloudSyncFilesModal, setShowCloudSyncFilesModal] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [freezingArtifact, setFreezingArtifact] = useState(false);
  const [operationState, setOperationState] = useState<CloudSyncOperationState>(
    () => defaultOperationState
  );

  const { showSuccessToast, showErrorToast } = useToast();
  const cloudSaveProvider =
    useAppSelector((state) => state.userPreferences.value?.cloudSaveProvider) ??
    hydraCloudProviderId;
  const ludusaviBackupsCacheKey = `${cloudSaveProvider}:${shop}:${objectId}`;
  const cloudSyncOperationKey = `${shop}:${objectId}`;

  const {
    restoringBackup,
    uploadingBackup,
    refreshingLudusaviBackups,
    uploadingLudusaviBackup,
    restoringLudusaviBackup,
  } = operationState;

  const downloadGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      updateOperationState(cloudSyncOperationKey, { restoringBackup: true });
      window.electron.downloadGameArtifact(objectId, shop, gameArtifactId);
    },
    [cloudSyncOperationKey, objectId, shop]
  );

  const getGameArtifacts = useCallback(async () => {
    if (shop === "custom") {
      setArtifacts([]);
      return;
    }

    const params = new URLSearchParams({
      objectId,
      shop,
    });

    const results = await window.electron.hydraApi
      .get<GameArtifact[]>(`/profile/games/artifacts?${params.toString()}`, {
        needsSubscription: true,
      })
      .catch(() => {
        return [];
      });
    setArtifacts(results);
  }, [objectId, shop]);

  const getGameBackupPreview = useCallback(async () => {
    setLoadingPreview(true);

    try {
      const preview = await window.electron.getGameBackupPreview(
        objectId,
        shop
      );

      setBackupPreview(preview);
    } catch (err) {
      logger.error("Failed to get game backup preview", objectId, shop, err);
    } finally {
      setLoadingPreview(false);
    }
  }, [objectId, shop]);

  const uploadSaveGame = useCallback(
    async (downloadOptionTitle: string | null) => {
      updateOperationState(cloudSyncOperationKey, { uploadingBackup: true });
      window.electron
        .uploadSaveGame(objectId, shop, downloadOptionTitle)
        .catch((err) => {
          updateOperationState(cloudSyncOperationKey, {
            uploadingBackup: false,
          });
          logger.error("Failed to upload save game", { objectId, shop, err });
          showErrorToast(t("backup_failed"));
        });
    },
    [cloudSyncOperationKey, objectId, shop, t, showErrorToast]
  );

  const refreshLudusaviBackups = useCallback(async () => {
    const operationEntry = getOperationEntry(cloudSyncOperationKey);

    if (operationEntry.refreshLudusaviBackupsPromise) {
      return operationEntry.refreshLudusaviBackupsPromise;
    }

    const refreshPromise = (async () => {
      updateOperationState(cloudSyncOperationKey, {
        refreshingLudusaviBackups: true,
      });

      try {
        const backups = await window.electron.listLudusaviGameBackups(
          objectId,
          shop
        );
        const updatedAt = new Date();

        ludusaviBackupsCache.set(ludusaviBackupsCacheKey, {
          backups,
          updatedAt,
        });
        setLudusaviBackups(backups);
        setLudusaviBackupsUpdatedAt(updatedAt);
      } catch (err) {
        logger.error("Failed to list Ludusavi backups", err);
        showErrorToast(t("backup_failed"));
      } finally {
        updateOperationState(cloudSyncOperationKey, {
          refreshingLudusaviBackups: false,
        });
        getOperationEntry(cloudSyncOperationKey).refreshLudusaviBackupsPromise =
          null;
      }
    })();

    operationEntry.refreshLudusaviBackupsPromise = refreshPromise;

    return refreshPromise;
  }, [
    cloudSyncOperationKey,
    ludusaviBackupsCacheKey,
    objectId,
    shop,
    showErrorToast,
    t,
  ]);

  const uploadLudusaviCloudBackup = useCallback(async () => {
    const operationEntry = getOperationEntry(cloudSyncOperationKey);

    if (operationEntry.uploadLudusaviBackupPromise) {
      return operationEntry.uploadLudusaviBackupPromise;
    }

    const uploadPromise = (async () => {
      updateOperationState(cloudSyncOperationKey, {
        uploadingLudusaviBackup: true,
      });

      try {
        await window.electron.uploadLudusaviCloudBackup(objectId, shop);
        showSuccessToast(t("backup_uploaded"));
        updateOperationState(cloudSyncOperationKey, {
          uploadingLudusaviBackup: false,
        });
        await refreshLudusaviBackups();
      } catch (err) {
        logger.error("Failed to upload Ludusavi cloud backup", err);
        showErrorToast(t("backup_failed"));
      } finally {
        updateOperationState(cloudSyncOperationKey, {
          uploadingLudusaviBackup: false,
        });
        getOperationEntry(cloudSyncOperationKey).uploadLudusaviBackupPromise =
          null;
      }
    })();

    operationEntry.uploadLudusaviBackupPromise = uploadPromise;

    return uploadPromise;
  }, [
    cloudSyncOperationKey,
    objectId,
    refreshLudusaviBackups,
    shop,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const restoreLudusaviCloudBackup = useCallback(
    async (backupName?: string) => {
      const operationEntry = getOperationEntry(cloudSyncOperationKey);

      if (operationEntry.restoreLudusaviBackupPromise) {
        return operationEntry.restoreLudusaviBackupPromise;
      }

      const restorePromise = (async () => {
        updateOperationState(cloudSyncOperationKey, {
          restoringLudusaviBackup: true,
        });

        try {
          await window.electron.restoreLudusaviCloudBackup(
            objectId,
            shop,
            backupName
          );
          showSuccessToast(t("backup_restored"));
          updateOperationState(cloudSyncOperationKey, {
            restoringLudusaviBackup: false,
          });
          getGameBackupPreview();
          await refreshLudusaviBackups();
        } catch (err) {
          logger.error("Failed to restore Ludusavi cloud backup", err);
          showErrorToast(t("backup_failed"));
        } finally {
          updateOperationState(cloudSyncOperationKey, {
            restoringLudusaviBackup: false,
          });
          getOperationEntry(
            cloudSyncOperationKey
          ).restoreLudusaviBackupPromise = null;
        }
      })();

      operationEntry.restoreLudusaviBackupPromise = restorePromise;

      return restorePromise;
    },
    [
      cloudSyncOperationKey,
      getGameBackupPreview,
      objectId,
      refreshLudusaviBackups,
      shop,
      showErrorToast,
      showSuccessToast,
      t,
    ]
  );

  const toggleArtifactFreeze = useCallback(
    async (gameArtifactId: string, freeze: boolean) => {
      setFreezingArtifact(true);
      try {
        const endpoint = freeze ? "freeze" : "unfreeze";
        await window.electron.hydraApi.put(
          `/profile/games/artifacts/${gameArtifactId}/${endpoint}`
        );
        getGameArtifacts();
      } catch (err) {
        logger.error("Failed to toggle artifact freeze", objectId, shop, err);
        throw err;
      } finally {
        setFreezingArtifact(false);
      }
    },
    [objectId, shop, getGameArtifacts]
  );

  useEffect(() => {
    const removeUploadCompleteListener = window.electron.onUploadComplete(
      objectId,
      shop,
      (success) => {
        updateOperationState(cloudSyncOperationKey, {
          uploadingBackup: false,
        });

        if (success) {
          showSuccessToast(t("backup_uploaded"));
          getGameArtifacts();
          getGameBackupPreview();
        } else {
          showErrorToast(t("backup_failed"));
        }
      }
    );

    const removeDownloadCompleteListener =
      window.electron.onBackupDownloadComplete(objectId, shop, (success) => {
        updateOperationState(cloudSyncOperationKey, {
          restoringBackup: false,
        });

        if (success) {
          showSuccessToast(t("backup_restored"));
          getGameArtifacts();
          getGameBackupPreview();
        } else {
          showErrorToast(t("backup_failed"));
        }
      });

    return () => {
      removeUploadCompleteListener();
      removeDownloadCompleteListener();
    };
  }, [
    objectId,
    shop,
    cloudSyncOperationKey,
    showErrorToast,
    showSuccessToast,
    t,
    getGameBackupPreview,
    getGameArtifacts,
  ]);

  const deleteGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      return window.electron.hydraApi
        .delete<{ ok: boolean }>(`/profile/games/artifacts/${gameArtifactId}`)
        .then(() => {
          getGameBackupPreview();
          getGameArtifacts();
        });
    },
    [getGameBackupPreview, getGameArtifacts]
  );

  useEffect(() => {
    setBackupPreview(null);
    setArtifacts([]);
  }, [objectId, shop]);

  useEffect(() => {
    const cachedBackups = ludusaviBackupsCache.get(ludusaviBackupsCacheKey);

    setLudusaviBackups(cachedBackups?.backups ?? []);
    setLudusaviBackupsUpdatedAt(cachedBackups?.updatedAt ?? null);
  }, [ludusaviBackupsCacheKey]);

  useEffect(() => {
    setOperationState(getOperationState(cloudSyncOperationKey));

    return subscribeToOperationState(cloudSyncOperationKey, setOperationState);
  }, [cloudSyncOperationKey]);

  const backupState = useMemo(() => {
    if (!backupPreview) return CloudSyncState.Unknown;
    if (backupPreview.overall.changedGames.new) return CloudSyncState.New;
    if (backupPreview.overall.changedGames.different)
      return CloudSyncState.Different;
    if (backupPreview.overall.changedGames.same) return CloudSyncState.Same;

    return CloudSyncState.Unknown;
  }, [backupPreview]);

  const isCloudSyncOperationRunning =
    uploadingBackup ||
    restoringBackup ||
    uploadingLudusaviBackup ||
    restoringLudusaviBackup;

  return (
    <Provider
      value={{
        backupPreview,
        artifacts,
        ludusaviBackups,
        ludusaviBackupsUpdatedAt,
        backupState,
        restoringBackup,
        uploadingBackup,
        refreshingLudusaviBackups,
        uploadingLudusaviBackup,
        restoringLudusaviBackup,
        isCloudSyncOperationRunning,
        showCloudSyncFilesModal,
        loadingPreview,
        freezingArtifact,
        uploadSaveGame,
        refreshLudusaviBackups,
        uploadLudusaviCloudBackup,
        restoreLudusaviCloudBackup,
        downloadGameArtifact,
        deleteGameArtifact,
        setShowCloudSyncFilesModal,
        getGameBackupPreview,
        getGameArtifacts,
        toggleArtifactFreeze,
      }}
    >
      {children}
    </Provider>
  );
}
