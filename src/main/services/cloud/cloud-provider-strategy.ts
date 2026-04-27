import type {
  CloudSaveProvider,
  GameArtifact,
  GameShop,
  UserPreferences,
} from "@types";
import type { CloudSyncStoredArtifact } from "./cloud-sync-manifest";

export interface CloudProviderContext {
  refreshToken: string;
  userPreferences: UserPreferences | null;
  shop: GameShop;
  objectId: string;
}

export interface CloudArtifactUpload {
  artifact: CloudSyncStoredArtifact;
  archivePath: string;
}

export interface CloudArtifactDownload {
  archiveBuffer: Buffer;
  homeDir: string;
  winePrefixPath: string | null;
}

export interface CloudProviderStrategy {
  listGameArtifacts(context: CloudProviderContext): Promise<GameArtifact[]>;
  uploadGameArtifact(
    context: CloudProviderContext,
    upload: CloudArtifactUpload
  ): Promise<void>;
  downloadGameArtifact(
    context: CloudProviderContext,
    artifactId: string
  ): Promise<CloudArtifactDownload>;
  deleteGameArtifact(
    context: CloudProviderContext,
    artifactId: string
  ): Promise<void>;
  renameGameArtifact(
    context: CloudProviderContext,
    artifactId: string,
    label: string
  ): Promise<void>;
  toggleGameArtifactFreeze(
    context: CloudProviderContext,
    artifactId: string,
    freeze: boolean
  ): Promise<void>;
}

export interface CloudProviderDefinition {
  id: CloudSaveProvider;
  label: string;
  disconnectedErrorMessage: string;
  strategy: CloudProviderStrategy;
  getRefreshToken(userPreferences: UserPreferences | null): string | null;
}
