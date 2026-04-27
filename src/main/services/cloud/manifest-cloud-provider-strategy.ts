import type { GameArtifact } from "@types";
import type {
  CloudArtifactDownload,
  CloudArtifactUpload,
  CloudProviderContext,
  CloudProviderStrategy,
} from "./cloud-provider-strategy";
import type { CloudSyncManifest } from "./cloud-sync-manifest";

export abstract class ManifestCloudProviderStrategy
  implements CloudProviderStrategy
{
  protected abstract readManifest(
    context: CloudProviderContext
  ): Promise<CloudSyncManifest>;

  protected abstract writeManifest(
    context: CloudProviderContext,
    manifest: CloudSyncManifest
  ): Promise<void>;

  protected abstract uploadArchive(
    context: CloudProviderContext,
    fileName: string,
    archivePath: string
  ): Promise<void>;

  protected abstract downloadArchive(
    context: CloudProviderContext,
    fileName: string
  ): Promise<Buffer>;

  protected abstract deleteArchive(
    context: CloudProviderContext,
    fileName: string
  ): Promise<void>;

  public async listGameArtifacts(
    context: CloudProviderContext
  ): Promise<GameArtifact[]> {
    const manifest = await this.readManifest(context);

    return manifest.artifacts.map(
      ({
        fileName: _fileName,
        homeDir: _homeDir,
        winePrefixPath: _winePrefixPath,
        ...artifact
      }) => artifact
    );
  }

  public async uploadGameArtifact(
    context: CloudProviderContext,
    upload: CloudArtifactUpload
  ) {
    await this.uploadArchive(
      context,
      upload.artifact.fileName,
      upload.archivePath
    );

    const manifest = await this.readManifest(context);
    manifest.artifacts = [upload.artifact, ...manifest.artifacts];
    await this.writeManifest(context, manifest);
  }

  public async downloadGameArtifact(
    context: CloudProviderContext,
    artifactId: string
  ): Promise<CloudArtifactDownload> {
    const manifest = await this.readManifest(context);
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) {
      throw new Error("Cloud backup could not be found");
    }

    const archiveBuffer = await this.downloadArchive(
      context,
      artifact.fileName
    );

    artifact.downloadCount += 1;
    artifact.updatedAt = new Date().toISOString();
    await this.writeManifest(context, manifest);

    return {
      archiveBuffer,
      homeDir: artifact.homeDir,
      winePrefixPath: artifact.winePrefixPath,
    };
  }

  public async deleteGameArtifact(
    context: CloudProviderContext,
    artifactId: string
  ) {
    const manifest = await this.readManifest(context);
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) return;

    await this.deleteArchive(context, artifact.fileName);

    manifest.artifacts = manifest.artifacts.filter(
      (entry) => entry.id !== artifactId
    );
    await this.writeManifest(context, manifest);
  }

  public async renameGameArtifact(
    context: CloudProviderContext,
    artifactId: string,
    label: string
  ) {
    const manifest = await this.readManifest(context);
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) {
      throw new Error("Cloud backup could not be found");
    }

    artifact.label = label;
    artifact.updatedAt = new Date().toISOString();
    await this.writeManifest(context, manifest);
  }

  public async toggleGameArtifactFreeze(
    context: CloudProviderContext,
    artifactId: string,
    freeze: boolean
  ) {
    const manifest = await this.readManifest(context);
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) {
      throw new Error("Cloud backup could not be found");
    }

    artifact.isFrozen = freeze;
    artifact.updatedAt = new Date().toISOString();
    await this.writeManifest(context, manifest);
  }
}
