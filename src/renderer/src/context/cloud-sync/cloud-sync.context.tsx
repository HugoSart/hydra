import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type { LudusaviBackup, GameArtifact, GameShop } from "@types";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "../game-details/game-details.context";

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
  renameGameArtifact: (gameArtifactId: string, label: string) => Promise<void>;
  setShowCloudSyncFilesModal: React.Dispatch<React.SetStateAction<boolean>>;
  getGameBackupPreview: () => Promise<void>;
  getGameArtifacts: () => Promise<void>;
  toggleArtifactFreeze: (
    gameArtifactId: string,
    freeze: boolean
  ) => Promise<void>;
  restoringBackup: boolean;
  uploadingBackup: boolean;
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
  renameGameArtifact: async () => {},
  showCloudSyncFilesModal: false,
  setShowCloudSyncFilesModal: () => {},
  getGameBackupPreview: async () => {},
  toggleArtifactFreeze: async () => {},
  getGameArtifacts: async () => {},
  restoringBackup: false,
  uploadingBackup: false,
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

export function CloudSyncContextProvider({
  children,
  objectId,
  shop,
}: CloudSyncContextProviderProps) {
  const { t } = useTranslation("game_details");
  const { game } = useContext(gameDetailsContext);

  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [backupPreview, setBackupPreview] = useState<LudusaviBackup | null>(
    null
  );
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [uploadingBackup, setUploadingBackup] = useState(false);
  const [showCloudSyncFilesModal, setShowCloudSyncFilesModal] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [freezingArtifact, setFreezingArtifact] = useState(false);

  const { showSuccessToast, showErrorToast } = useToast();

  const downloadGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      setRestoringBackup(true);
      window.electron
        .downloadGameArtifact(objectId, shop, gameArtifactId)
        .catch((err) => {
          setRestoringBackup(false);
          logger.error("Failed to start artifact download", {
            objectId,
            shop,
            err,
          });
          showErrorToast(t("backup_failed"));
        });
    },
    [objectId, shop, showErrorToast, t]
  );

  const getGameArtifacts = useCallback(async () => {
    if (shop === "custom") {
      setArtifacts([]);
      return;
    }

    try {
      const results = await window.electron.getGameArtifacts(objectId, shop);
      setArtifacts(results);
    } catch (err) {
      logger.error("Failed to get game artifacts", { objectId, shop, err });
      setArtifacts([]);
    }
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
      setUploadingBackup(true);
      window.electron
        .uploadSaveGame(objectId, shop, downloadOptionTitle)
        .catch((err) => {
          setUploadingBackup(false);
          logger.error("Failed to upload save game", { objectId, shop, err });
          showErrorToast(t("backup_failed"));
        });
    },
    [objectId, shop, t, showErrorToast]
  );

  const toggleArtifactFreeze = useCallback(
    async (gameArtifactId: string, freeze: boolean) => {
      setFreezingArtifact(true);
      try {
        await window.electron.toggleGameArtifactFreeze(
          objectId,
          shop,
          gameArtifactId,
          freeze
        );
        await getGameArtifacts();
      } catch (err) {
        logger.error("Failed to toggle artifact freeze", objectId, shop, err);
        throw err;
      } finally {
        setFreezingArtifact(false);
      }
    },
    [objectId, shop, getGameArtifacts]
  );

  const renameGameArtifact = useCallback(
    async (gameArtifactId: string, label: string) => {
      await window.electron.renameGameArtifact(
        objectId,
        shop,
        gameArtifactId,
        label
      );
      await getGameArtifacts();
    },
    [getGameArtifacts, objectId, shop]
  );

  useEffect(() => {
    const removeUploadCompleteListener = window.electron.onUploadComplete(
      objectId,
      shop,
      () => {
        showSuccessToast(t("backup_uploaded"));
        setUploadingBackup(false);
        getGameArtifacts();
        getGameBackupPreview();
      }
    );

    const removeDownloadCompleteListener =
      window.electron.onBackupDownloadComplete(objectId, shop, (success) => {
        if (success) {
          showSuccessToast(t("backup_restored"));
        } else {
          showErrorToast(t("backup_failed"));
        }

        setRestoringBackup(false);
        getGameArtifacts();
        getGameBackupPreview();
      });

    return () => {
      removeUploadCompleteListener();
      removeDownloadCompleteListener();
    };
  }, [
    objectId,
    shop,
    showSuccessToast,
    showErrorToast,
    t,
    getGameBackupPreview,
    getGameArtifacts,
  ]);

  const deleteGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      await window.electron.deleteGameArtifact(objectId, shop, gameArtifactId);
      await getGameBackupPreview();
      await getGameArtifacts();
    },
    [getGameBackupPreview, getGameArtifacts, objectId, shop]
  );

  useEffect(() => {
    setBackupPreview(null);
    setArtifacts([]);
    setRestoringBackup(false);
    setUploadingBackup(false);
  }, [objectId, shop, game?.cloudSaveProvider]);

  const backupState = useMemo(() => {
    if (!backupPreview) return CloudSyncState.Unknown;
    if (backupPreview.overall.changedGames.new) return CloudSyncState.New;
    if (backupPreview.overall.changedGames.different)
      return CloudSyncState.Different;
    if (backupPreview.overall.changedGames.same) return CloudSyncState.Same;

    return CloudSyncState.Unknown;
  }, [backupPreview]);

  return (
    <Provider
      value={{
        backupPreview,
        artifacts,
        backupState,
        restoringBackup,
        uploadingBackup,
        showCloudSyncFilesModal,
        loadingPreview,
        freezingArtifact,
        uploadSaveGame,
        downloadGameArtifact,
        deleteGameArtifact,
        renameGameArtifact,
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
