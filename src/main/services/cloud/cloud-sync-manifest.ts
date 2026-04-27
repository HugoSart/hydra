import type { GameArtifact, GameShop } from "@types";

export const DEFAULT_EXTERNAL_CLOUD_ROOT_FOLDER = "Hydra";
export const CLOUD_SYNC_MANIFEST_FILE_NAME = "manifest.json";

export interface CloudSyncStoredArtifact extends GameArtifact {
  fileName: string;
  homeDir: string;
  winePrefixPath: string | null;
}

export interface CloudSyncManifest {
  version: 1;
  artifacts: CloudSyncStoredArtifact[];
}

export const createEmptyCloudSyncManifest = (): CloudSyncManifest => ({
  version: 1,
  artifacts: [],
});

export const getCloudSyncGameFolderName = (shop: GameShop, objectId: string) =>
  `${shop}-${objectId}`;
