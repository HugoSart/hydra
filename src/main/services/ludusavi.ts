import type {
  GameShop,
  LudusaviBackup,
  LudusaviBackupEntry,
  LudusaviBackups,
  LudusaviConfig,
} from "@types";

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import cp from "node:child_process";
import { SystemPath } from "./system-path";

export class Ludusavi {
  private static availableCloudProviderIds = [
    "box",
    "dropbox",
    "google-drive",
    "onedrive",
  ];

  private static ludusaviResourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, "ludusavi")
    : path.join(__dirname, "..", "..", "ludusavi");

  private static configPath = path.join(
    SystemPath.getPath("userData"),
    "ludusavi"
  );
  private static binaryName =
    process.platform === "win32" ? "ludusavi.exe" : "ludusavi";

  private static binaryPath = path.join(this.configPath, this.binaryName);

  private static getCommandErrorMessage(
    err: cp.ExecFileException,
    stdout: string,
    stderr: string
  ) {
    return [err.message, stderr, stdout].filter(Boolean).join("\n").trim();
  }

  private static async runCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.execFile(
        this.binaryPath,
        ["--config", this.configPath, ...args],
        (err: cp.ExecFileException | null, stdout: string, stderr: string) => {
          if (err) {
            return reject(
              new Error(this.getCommandErrorMessage(err, stdout, stderr))
            );
          }

          return resolve(stdout);
        }
      );
    });
  }

  public static async getConfig() {
    const config = YAML.parse(
      fs.readFileSync(path.join(this.configPath, "config.yaml"), "utf-8")
    ) as LudusaviConfig;

    return config;
  }

  public static async listAvailableCloudProviders() {
    return [...this.availableCloudProviderIds];
  }

  public static async getCurrentCloudProvider(): Promise<string | null> {
    const config = await this.getConfig();
    const remote = config.cloud?.remote;

    if (!remote) {
      return null;
    }

    const [configKey] = Object.keys(remote);

    if (!configKey) {
      return null;
    }

    return (
      this.availableCloudProviderIds.find(
        (providerId) =>
          providerId.replace(/-/g, "").toLowerCase() === configKey.toLowerCase()
      ) ?? null
    );
  }

  public static async getCloudPath(): Promise<string> {
    const config = await this.getConfig();

    return config.cloud?.path ?? "ludusavi-backup";
  }

  public static async getBackupPath(): Promise<string | null> {
    const config = await this.getConfig();

    return config.backup?.path ?? config.restore?.path ?? null;
  }

  public static async setCloudPath(cloudPath: string): Promise<void> {
    const config = await this.getConfig();

    config.cloud = {
      remote: null,
      synchronize: true,
      ...config.cloud,
      path: cloudPath,
    };

    fs.writeFileSync(
      path.join(this.configPath, "config.yaml"),
      YAML.stringify(config)
    );
  }

  public static async setCloudProvider(providerId: string): Promise<void> {
    if (!this.availableCloudProviderIds.includes(providerId)) {
      throw new Error(`Unsupported Ludusavi cloud provider: ${providerId}`);
    }

    return new Promise((resolve, reject) => {
      cp.execFile(
        this.binaryPath,
        ["--config", this.configPath, "cloud", "set", providerId],
        (err: cp.ExecFileException | null, stdout: string, stderr: string) => {
          if (err) {
            return reject(
              new Error(this.getCommandErrorMessage(err, stdout, stderr))
            );
          }

          return resolve();
        }
      );
    });
  }

  public static async clearCloudProvider(): Promise<void> {
    return new Promise((resolve, reject) => {
      cp.execFile(
        this.binaryPath,
        ["--config", this.configPath, "cloud", "set", "none"],
        (err: cp.ExecFileException | null, stdout: string, stderr: string) => {
          if (err) {
            return reject(
              new Error(this.getCommandErrorMessage(err, stdout, stderr))
            );
          }

          return resolve();
        }
      );
    });
  }

  public static async uploadCloudBackups(objectId: string): Promise<void> {
    const backupPath = await this.getBackupPath();
    const args = ["cloud", "upload", "--api", "--force"];

    if (backupPath) {
      args.push("--local", backupPath);
    }

    args.push(objectId);

    await this.runCommand(args);
  }

  public static async downloadCloudBackups(objectId: string): Promise<void> {
    const backupPath = await this.getBackupPath();
    const args = ["cloud", "download", "--api", "--force"];

    if (backupPath) {
      args.push("--local", backupPath);
    }

    args.push(objectId);

    await this.runCommand(args);
  }

  public static async listGameBackups(
    objectId: string
  ): Promise<LudusaviBackupEntry[]> {
    const backupPath = await this.getBackupPath();
    const args = ["backups", "--api"];

    if (backupPath) {
      args.push("--path", backupPath);
    }

    args.push(objectId);

    const stdout = await this.runCommand(args);
    const data = JSON.parse(stdout) as LudusaviBackups;

    return data.games[objectId]?.backups ?? [];
  }

  public static async restoreGame(
    objectId: string,
    backupName?: string
  ): Promise<LudusaviBackup> {
    const backupPath = await this.getBackupPath();
    const args = ["restore", "--api", "--force"];

    if (backupPath) {
      args.push("--path", backupPath);
    }

    if (backupName) {
      args.push("--backup", backupName);
    }

    args.push(objectId);

    const stdout = await this.runCommand(args);

    return JSON.parse(stdout) as LudusaviBackup;
  }

  public static async copyConfigFileToUserData() {
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true });

      fs.cpSync(
        path.join(this.ludusaviResourcesPath, "config.yaml"),
        path.join(this.configPath, "config.yaml")
      );
    }
  }

  public static async copyBinaryToUserData() {
    if (!fs.existsSync(this.binaryPath)) {
      fs.cpSync(
        path.join(this.ludusaviResourcesPath, this.binaryName),
        this.binaryPath
      );
    }
  }

  public static async backupGame(
    _shop: GameShop,
    objectId: string,
    backupPath?: string | null,
    winePrefix?: string | null,
    preview?: boolean
  ): Promise<LudusaviBackup> {
    return new Promise((resolve, reject) => {
      const args = [
        "--config",
        this.configPath,
        "backup",
        objectId,
        "--api",
        "--force",
      ];

      if (preview) args.push("--preview");
      if (backupPath) args.push("--path", backupPath);
      if (winePrefix) args.push("--wine-prefix", winePrefix);

      cp.execFile(
        this.binaryPath,
        args,
        (err: cp.ExecFileException | null, stdout: string) => {
          if (err) {
            return reject(err);
          }

          return resolve(JSON.parse(stdout) as LudusaviBackup);
        }
      );
    });
  }

  public static async getBackupPreview(
    _shop: GameShop,
    objectId: string,
    winePrefix?: string | null
  ): Promise<LudusaviBackup | null> {
    const config = await this.getConfig();

    const backupData = await this.backupGame(
      _shop,
      objectId,
      null,
      winePrefix,
      true
    );

    const customGame = config.customGames.find(
      (game) => game.name === objectId
    );

    return {
      ...backupData,
      customBackupPath: customGame?.files[0] || null,
    };
  }

  static async addCustomGame(title: string, savePath: string | null) {
    const config = await this.getConfig();
    const filteredGames = config.customGames.filter(
      (game) => game.name !== title
    );

    if (savePath) {
      filteredGames.push({
        name: title,
        files: [savePath],
        registry: [],
      });
    }

    config.customGames = filteredGames;

    fs.writeFileSync(
      path.join(this.configPath, "config.yaml"),
      YAML.stringify(config)
    );
  }
}
