import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type { LudusaviBackup, GameArtifact, GameShop } from "@types";
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
  showCloudSyncFilesModal: boolean;
  backupState: CloudSyncState;
  downloadGameArtifact: (gameArtifactId: string) => Promise<void>;
  uploadSaveGame: (downloadOptionTitle: string | null) => Promise<void>;
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
  isCloudSyncOperationRunning: boolean;
  loadingPreview: boolean;
  freezingArtifact: boolean;
}

export const cloudSyncContext = createContext<CloudSyncContext>({
  backupPreview: null,
  backupState: CloudSyncState.Unknown,
  downloadGameArtifact: async () => {},
  uploadSaveGame: async () => {},
  artifacts: [],
  deleteGameArtifact: async () => {},
  showCloudSyncFilesModal: false,
  setShowCloudSyncFilesModal: () => {},
  getGameBackupPreview: async () => {},
  toggleArtifactFreeze: async () => {},
  getGameArtifacts: async () => {},
  restoringBackup: false,
  uploadingBackup: false,
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

type CloudSyncOperationState = {
  restoringBackup: boolean;
  uploadingBackup: boolean;
};

type CloudSyncOperationEntry = CloudSyncOperationState;

const defaultOperationState: CloudSyncOperationState = {
  restoringBackup: false,
  uploadingBackup: false,
};

const cloudSyncOperationStore = new Map<string, CloudSyncOperationEntry>();
const cloudSyncOperationListeners = new Map<
  string,
  Set<(state: CloudSyncOperationState) => void>
>();

const createOperationEntry = (): CloudSyncOperationEntry => ({
  ...defaultOperationState,
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
  const cloudSyncOperationKey = `${shop}:${objectId}`;

  const { restoringBackup, uploadingBackup } = operationState;

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

    const results = await window.electron
      .getGameArtifacts(objectId, shop)
      .catch((err) => {
        logger.error("Failed to get game artifacts", objectId, shop, err);
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
      return window.electron
        .uploadSaveGame(objectId, shop, downloadOptionTitle)
        .catch((err) => {
          updateOperationState(cloudSyncOperationKey, {
            uploadingBackup: false,
          });
          logger.error("Failed to upload save game", { objectId, shop, err });
          showErrorToast(t("backup_failed"));
        })
        .finally(() => {
          updateOperationState(cloudSyncOperationKey, {
            uploadingBackup: false,
          });
        });
    },
    [cloudSyncOperationKey, objectId, shop, t, showErrorToast]
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

  const isCloudSyncOperationRunning = uploadingBackup || restoringBackup;

  return (
    <Provider
      value={{
        backupPreview,
        artifacts,
        backupState,
        restoringBackup,
        uploadingBackup,
        isCloudSyncOperationRunning,
        showCloudSyncFilesModal,
        loadingPreview,
        freezingArtifact,
        uploadSaveGame,
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
