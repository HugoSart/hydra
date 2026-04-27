import { backupsPath, publicProfilePath } from "@main/constants";
import { addTrailingSlash, normalizePath, parseRegFile } from "@main/helpers";
import { db, gamesSublevel, levelKeys } from "@main/level";
import type {
  CloudSaveProvider,
  Game,
  GameArtifact,
  GameShop,
  LudusaviBackupMapping,
  User,
  UserPreferences,
} from "@types";
import axios from "axios";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import YAML from "yaml";
import { formatDate, SubscriptionRequiredError } from "@shared";
import i18next, { t } from "i18next";
import type { CloudSyncStoredArtifact } from "./cloud/cloud-sync-manifest";
import { getCloudProviderDefinition } from "./cloud/cloud-provider-registry";
import type {
  CloudArtifactDownload,
  CloudProviderContext,
  CloudProviderDefinition,
} from "./cloud/cloud-provider-strategy";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import { Ludusavi } from "./ludusavi";
import { SystemPath } from "./system-path";
import { WindowManager } from "./window-manager";
import { Wine } from "./wine";

type CloudSyncProviderKind = "hydra" | CloudSaveProvider;

type ResolvedCloudSyncProvider =
  | {
      kind: "hydra";
      game: Game | null;
      userPreferences: UserPreferences | null;
      effectiveWinePrefixPath: string | null;
    }
  | {
      kind: "external";
      providerId: CloudSaveProvider;
      providerDefinition: CloudProviderDefinition;
      game: Game | null;
      userPreferences: UserPreferences | null;
      effectiveWinePrefixPath: string | null;
      refreshToken: string;
    };

export class CloudSync {
  public static getWindowsLikeUserProfilePath(winePrefixPath?: string | null) {
    if (process.platform === "linux") {
      if (!winePrefixPath) {
        throw new Error("Wine prefix path is required");
      }

      const userReg = fs.readFileSync(
        path.join(winePrefixPath, "user.reg"),
        "utf8"
      );

      const entries = parseRegFile(userReg);
      const volatileEnvironment = entries.find(
        (entry) => entry.path === "Volatile Environment"
      );

      if (!volatileEnvironment) {
        throw new Error("Volatile environment not found in user.reg");
      }

      const { values } = volatileEnvironment;
      const userProfile = String(values["USERPROFILE"]);

      if (userProfile) {
        return normalizePath(userProfile);
      }

      throw new Error("User profile not found in user.reg");
    }

    return normalizePath(SystemPath.getPath("home"));
  }

  public static getBackupLabel(automatic: boolean) {
    const language = i18next.language;
    const date = formatDate(new Date(), language);

    if (automatic) {
      return t("automatic_backup_from", {
        ns: "game_details",
        date,
      });
    }

    return t("backup_from", {
      ns: "game_details",
      date,
    });
  }

  public static transformLudusaviBackupPathIntoWindowsPath(
    backupPath: string,
    winePrefixPath?: string | null
  ) {
    return backupPath
      .replace(winePrefixPath ? addTrailingSlash(winePrefixPath) : "", "")
      .replace("drive_c", "C:");
  }

  public static addWinePrefixToWindowsPath(
    windowsPath: string,
    winePrefixPath?: string | null
  ) {
    if (!winePrefixPath) {
      return windowsPath;
    }

    return path.join(winePrefixPath, windowsPath.replace("C:", "drive_c"));
  }

  private static async getUserPreferences() {
    return db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
  }

  private static async getHasActiveHydraSubscription() {
    return db
      .get<string, User>(levelKeys.user, { valueEncoding: "json" })
      .then((user) => {
        const expiresAt = new Date(user?.subscription?.expiresAt ?? 0);
        return expiresAt > new Date();
      })
      .catch(() => false);
  }

  private static async getGameConfiguration(
    shop: GameShop,
    objectId: string
  ): Promise<{
    game: Game | null;
    userPreferences: UserPreferences | null;
    effectiveWinePrefixPath: string | null;
  }> {
    const game = await gamesSublevel
      .get<string, Game>(levelKeys.game(shop, objectId), {
        valueEncoding: "json",
      })
      .catch(() => null);
    const userPreferences = await this.getUserPreferences();

    return {
      game: game ?? null,
      userPreferences,
      effectiveWinePrefixPath: Wine.getEffectivePrefixPath(
        game?.winePrefixPath,
        objectId
      ),
    };
  }

  private static async getResolvedCloudProvider(
    shop: GameShop,
    objectId: string
  ): Promise<ResolvedCloudSyncProvider> {
    const { game, userPreferences, effectiveWinePrefixPath } =
      await this.getGameConfiguration(shop, objectId);
    const provider = game?.cloudSaveProvider ?? null;

    if (provider) {
      const providerDefinition = getCloudProviderDefinition(provider);
      const refreshToken = providerDefinition.getRefreshToken(userPreferences);

      if (!refreshToken) {
        throw new Error(providerDefinition.disconnectedErrorMessage);
      }

      return {
        kind: "external",
        providerId: provider,
        providerDefinition,
        game,
        userPreferences,
        effectiveWinePrefixPath,
        refreshToken,
      };
    }

    return {
      kind: "hydra",
      game,
      userPreferences,
      effectiveWinePrefixPath,
    };
  }

  private static async bundleBackup(
    shop: GameShop,
    objectId: string,
    winePrefix: string | null
  ) {
    const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

    if (fs.existsSync(backupPath)) {
      try {
        await fs.promises.rm(backupPath, { recursive: true });
      } catch (error) {
        logger.error("Failed to remove backup path", { backupPath, error });
      }
    }

    await Ludusavi.backupGame(shop, objectId, backupPath, winePrefix);

    const tarLocation = path.join(backupsPath, `${crypto.randomUUID()}.tar`);

    await tar.create(
      {
        gzip: false,
        file: tarLocation,
        cwd: backupPath,
      },
      ["."]
    );

    return tarLocation;
  }

  private static getArtifactWinePrefixPath(winePrefixPath: string | null) {
    if (!winePrefixPath) {
      return null;
    }

    return fs.existsSync(winePrefixPath)
      ? fs.realpathSync(winePrefixPath)
      : winePrefixPath;
  }

  private static createStoredArtifact(
    size: number,
    downloadOptionTitle: string | null,
    label: string | undefined,
    effectiveWinePrefixPath: string | null
  ): CloudSyncStoredArtifact {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    return {
      id,
      artifactLengthInBytes: size,
      downloadOptionTitle,
      createdAt: now,
      updatedAt: now,
      hostname: os.hostname(),
      downloadCount: 0,
      label,
      isFrozen: false,
      fileName: `${id}.tar`,
      homeDir: this.getWindowsLikeUserProfilePath(effectiveWinePrefixPath),
      winePrefixPath: this.getArtifactWinePrefixPath(effectiveWinePrefixPath),
    };
  }

  private static createProviderContext(
    provider: Extract<ResolvedCloudSyncProvider, { kind: "external" }>,
    shop: GameShop,
    objectId: string
  ): CloudProviderContext {
    return {
      refreshToken: provider.refreshToken,
      userPreferences: provider.userPreferences,
      shop,
      objectId,
    };
  }

  private static async uploadToHydraCloud(
    bundleLocation: string,
    shop: GameShop,
    objectId: string,
    effectiveWinePrefixPath: string | null,
    downloadOptionTitle: string | null,
    label: string | undefined
  ) {
    const stat = await fs.promises.stat(bundleLocation);

    const { uploadUrl } = await HydraApi.post<{
      id: string;
      uploadUrl: string;
    }>(
      "/profile/games/artifacts",
      {
        artifactLengthInBytes: stat.size,
        shop,
        objectId,
        hostname: os.hostname(),
        winePrefixPath: this.getArtifactWinePrefixPath(effectiveWinePrefixPath),
        homeDir: this.getWindowsLikeUserProfilePath(effectiveWinePrefixPath),
        downloadOptionTitle,
        platform: process.platform,
        label,
      },
      { needsSubscription: true }
    );

    const fileBuffer = await fs.promises.readFile(bundleLocation);

    await axios.put(uploadUrl, fileBuffer, {
      headers: {
        "Content-Type": "application/tar",
      },
    });
  }

  private static async uploadToExternalProvider(
    provider: Extract<ResolvedCloudSyncProvider, { kind: "external" }>,
    bundleLocation: string,
    shop: GameShop,
    objectId: string,
    downloadOptionTitle: string | null,
    label: string | undefined
  ) {
    const stat = await fs.promises.stat(bundleLocation);
    const artifact = this.createStoredArtifact(
      stat.size,
      downloadOptionTitle,
      label,
      provider.effectiveWinePrefixPath
    );

    await provider.providerDefinition.strategy.uploadGameArtifact(
      this.createProviderContext(provider, shop, objectId),
      {
        artifact,
        archivePath: bundleLocation,
      }
    );
  }

  private static restoreLudusaviBackup(
    backupPath: string,
    title: string,
    homeDir: string,
    winePrefixPath?: string | null,
    artifactWinePrefixPath?: string | null
  ) {
    const gameBackupPath = path.join(backupPath, title);
    const mappingYamlPath = path.join(gameBackupPath, "mapping.yaml");

    const data = fs.readFileSync(mappingYamlPath, "utf8");
    const manifest = YAML.parse(data) as {
      backups: LudusaviBackupMapping[];
      drives: Record<string, string>;
    };

    const userProfilePath =
      CloudSync.getWindowsLikeUserProfilePath(winePrefixPath);

    manifest.backups.forEach((backup) => {
      Object.keys(backup.files).forEach((key) => {
        const sourcePathWithDrives = Object.entries(manifest.drives).reduce(
          (prev, [driveKey, driveValue]) => prev.replace(driveValue, driveKey),
          key
        );

        const sourcePath = path.join(gameBackupPath, sourcePathWithDrives);

        const destinationPath = this.transformLudusaviBackupPathIntoWindowsPath(
          key,
          artifactWinePrefixPath
        )
          .replace(
            homeDir,
            this.addWinePrefixToWindowsPath(userProfilePath, winePrefixPath)
          )
          .replace(
            publicProfilePath,
            this.addWinePrefixToWindowsPath(publicProfilePath, winePrefixPath)
          );

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

        if (fs.existsSync(destinationPath)) {
          fs.unlinkSync(destinationPath);
        }

        fs.renameSync(sourcePath, destinationPath);
      });
    });
  }

  private static async downloadHydraArtifactArchive(
    objectId: string,
    shop: GameShop,
    gameArtifactId: string
  ) {
    const { downloadUrl, objectKey, homeDir, winePrefixPath } =
      await HydraApi.post<{
        downloadUrl: string;
        objectKey: string;
        homeDir: string;
        winePrefixPath: string | null;
      }>(`/profile/games/artifacts/${gameArtifactId}/download`, undefined, {
        needsSubscription: true,
      });

    const archivePath = path.join(SystemPath.getPath("userData"), objectKey);
    const response = await axios.get(downloadUrl, {
      responseType: "stream",
      onDownloadProgress: (progressEvent) => {
        WindowManager.mainWindow?.webContents.send(
          `on-backup-download-progress-${objectId}-${shop}`,
          progressEvent
        );
      },
    });

    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(archivePath);

      response.data.pipe(writer);

      writer.on("error", reject);
      writer.on("close", () => resolve());
    });

    return {
      archivePath,
      homeDir: normalizePath(homeDir),
      winePrefixPath,
    };
  }

  private static async downloadExternalArtifactArchive(
    provider: Extract<ResolvedCloudSyncProvider, { kind: "external" }>,
    shop: GameShop,
    objectId: string,
    gameArtifactId: string
  ) {
    const download: CloudArtifactDownload =
      await provider.providerDefinition.strategy.downloadGameArtifact(
        this.createProviderContext(provider, shop, objectId),
        gameArtifactId
      );

    const archivePath = path.join(
      SystemPath.getPath("userData"),
      `${crypto.randomUUID()}.tar`
    );

    await fs.promises.writeFile(archivePath, download.archiveBuffer);

    return {
      archivePath,
      homeDir: normalizePath(download.homeDir),
      winePrefixPath: download.winePrefixPath ?? null,
    };
  }

  public static async getGameArtifacts(objectId: string, shop: GameShop) {
    if (shop === "custom") {
      return [];
    }

    const provider = await this.getResolvedCloudProvider(shop, objectId);

    if (provider.kind === "hydra") {
      const hasActiveSubscription = await this.getHasActiveHydraSubscription();

      if (!hasActiveSubscription) {
        return [];
      }

      return HydraApi.get<GameArtifact[]>(
        "/profile/games/artifacts",
        { objectId, shop },
        { needsSubscription: true }
      );
    }

    return provider.providerDefinition.strategy.listGameArtifacts(
      this.createProviderContext(provider, shop, objectId)
    );
  }

  public static async uploadSaveGame(
    objectId: string,
    shop: GameShop,
    downloadOptionTitle: string | null,
    label?: string
  ) {
    const provider = await this.getResolvedCloudProvider(shop, objectId);

    if (provider.kind === "hydra") {
      const hasActiveSubscription = await this.getHasActiveHydraSubscription();

      if (!hasActiveSubscription) {
        throw new SubscriptionRequiredError();
      }
    }

    const bundleLocation = await this.bundleBackup(
      shop,
      objectId,
      provider.effectiveWinePrefixPath
    );

    try {
      if (provider.kind === "hydra") {
        await this.uploadToHydraCloud(
          bundleLocation,
          shop,
          objectId,
          provider.effectiveWinePrefixPath,
          downloadOptionTitle,
          label
        );
      } else {
        await this.uploadToExternalProvider(
          provider,
          bundleLocation,
          shop,
          objectId,
          downloadOptionTitle,
          label
        );
      }

      WindowManager.mainWindow?.webContents.send(
        `on-upload-complete-${objectId}-${shop}`,
        true
      );
    } finally {
      try {
        await fs.promises.unlink(bundleLocation);
      } catch (error) {
        logger.error("Failed to remove tar file", { bundleLocation, error });
      }
    }
  }

  public static async downloadGameArtifact(
    objectId: string,
    shop: GameShop,
    gameArtifactId: string
  ) {
    let archivePath: string | null = null;

    try {
      const provider = await this.getResolvedCloudProvider(shop, objectId);
      const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, {
          recursive: true,
          force: true,
        });
      }

      const download =
        provider.kind === "hydra"
          ? await this.downloadHydraArtifactArchive(
              objectId,
              shop,
              gameArtifactId
            )
          : await this.downloadExternalArtifactArchive(
              provider,
              shop,
              objectId,
              gameArtifactId
            );

      archivePath = download.archivePath;

      fs.mkdirSync(backupPath, { recursive: true });

      await tar.x({
        file: archivePath,
        cwd: backupPath,
      });

      this.restoreLudusaviBackup(
        backupPath,
        objectId,
        download.homeDir,
        provider.effectiveWinePrefixPath,
        download.winePrefixPath
      );

      WindowManager.mainWindow?.webContents.send(
        `on-backup-download-complete-${objectId}-${shop}`,
        true
      );
    } catch (error) {
      logger.error("Failed to download game artifact", error);

      WindowManager.mainWindow?.webContents.send(
        `on-backup-download-complete-${objectId}-${shop}`,
        false
      );
    } finally {
      if (archivePath) {
        try {
          await fs.promises.unlink(archivePath);
        } catch (error) {
          logger.error("Failed to remove downloaded archive", {
            archivePath,
            error,
          });
        }
      }
    }
  }

  public static async deleteGameArtifact(
    objectId: string,
    shop: GameShop,
    gameArtifactId: string
  ) {
    const provider = await this.getResolvedCloudProvider(shop, objectId);

    if (provider.kind === "hydra") {
      return HydraApi.delete(`/profile/games/artifacts/${gameArtifactId}`, {
        needsSubscription: true,
      });
    }

    return provider.providerDefinition.strategy.deleteGameArtifact(
      this.createProviderContext(provider, shop, objectId),
      gameArtifactId
    );
  }

  public static async renameGameArtifact(
    objectId: string,
    shop: GameShop,
    gameArtifactId: string,
    label: string
  ) {
    const provider = await this.getResolvedCloudProvider(shop, objectId);

    if (provider.kind === "hydra") {
      return HydraApi.put(
        `/profile/games/artifacts/${gameArtifactId}`,
        { label },
        { needsSubscription: true }
      );
    }

    return provider.providerDefinition.strategy.renameGameArtifact(
      this.createProviderContext(provider, shop, objectId),
      gameArtifactId,
      label
    );
  }

  public static async toggleGameArtifactFreeze(
    objectId: string,
    shop: GameShop,
    gameArtifactId: string,
    freeze: boolean
  ) {
    const provider = await this.getResolvedCloudProvider(shop, objectId);

    if (provider.kind === "hydra") {
      const endpoint = freeze ? "freeze" : "unfreeze";

      return HydraApi.put(
        `/profile/games/artifacts/${gameArtifactId}/${endpoint}`,
        undefined,
        { needsSubscription: true }
      );
    }

    return provider.providerDefinition.strategy.toggleGameArtifactFreeze(
      this.createProviderContext(provider, shop, objectId),
      gameArtifactId,
      freeze
    );
  }

  public static async getProviderKind(
    objectId: string,
    shop: GameShop
  ): Promise<CloudSyncProviderKind> {
    const { game } = await this.getGameConfiguration(shop, objectId);
    return game?.cloudSaveProvider ?? "hydra";
  }
}
