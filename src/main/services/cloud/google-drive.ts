import fs from "node:fs";
import { Readable } from "node:stream";
import { URL } from "node:url";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { GameArtifact, GameShop, UserPreferences } from "@types";
import {
  CLOUD_SYNC_MANIFEST_FILE_NAME,
  DEFAULT_EXTERNAL_CLOUD_ROOT_FOLDER,
  type CloudSyncManifest,
  type CloudSyncStoredArtifact,
  createEmptyCloudSyncManifest,
  getCloudSyncGameFolderName,
} from "./cloud-sync-manifest";
import {
  createOAuthState,
  waitForOAuthCallback,
} from "./oauth-callback-server";

const PROVIDER_NAME = "Google Drive";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"];
const DEFAULT_REDIRECT_PORT = 53682;
const CALLBACK_PATH = "/oauth/google/callback";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const getGoogleDriveOAuthConfig = () => {
  const clientId = import.meta.env.MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri =
    import.meta.env.MAIN_VITE_GOOGLE_DRIVE_REDIRECT_URI ??
    `http://127.0.0.1:${DEFAULT_REDIRECT_PORT}${CALLBACK_PATH}`;

  if (!clientId || !clientSecret) {
    throw new Error("Google Drive OAuth client is not configured");
  }

  return { clientId, clientSecret, redirectUri };
};

const getGoogleDriveCallbackError = (callbackUrl: URL) => {
  const error = callbackUrl.searchParams.get("error");
  if (!error) return null;

  if (error === "access_denied") {
    return new Error("Google Drive connection was canceled");
  }

  return new Error(`Google Drive connection failed: ${error}`);
};

const normalizeGoogleDrivePath = (value: string) =>
  value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");

const getGoogleDriveStorageMode = (userPreferences: UserPreferences | null) =>
  userPreferences?.googleDriveStorageMode ?? "appData";

const getGoogleDriveBaseFolderSegments = (
  userPreferences: UserPreferences | null
) => {
  const storageMode = getGoogleDriveStorageMode(userPreferences);

  if (storageMode === "customFolder") {
    const customPath = normalizeGoogleDrivePath(
      userPreferences?.googleDriveCustomPath ?? ""
    );

    if (!customPath) {
      throw new Error("Google Drive custom path is not configured");
    }

    return customPath.split("/");
  }

  return [DEFAULT_EXTERNAL_CLOUD_ROOT_FOLDER];
};

const escapeGoogleDriveQueryValue = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const streamToBuffer = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

export class GoogleDriveService {
  private static createOAuthClient(refreshToken: string) {
    const { clientId, clientSecret, redirectUri } = getGoogleDriveOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  private static getDriveClient(refreshToken: string) {
    const oauth2Client = this.createOAuthClient(refreshToken);

    return google.drive({
      version: "v3",
      auth: oauth2Client,
    });
  }

  private static async findFolderByName(
    drive: drive_v3.Drive,
    name: string,
    parentId: string,
    spaces: string
  ) {
    const escapedName = escapeGoogleDriveQueryValue(name);

    const response = await drive.files.list({
      spaces,
      q: [
        `mimeType='${FOLDER_MIME_TYPE}'`,
        `name='${escapedName}'`,
        `'${parentId}' in parents`,
        "trashed=false",
      ].join(" and "),
      fields: "files(id,name)",
      pageSize: 1,
    });

    return response.data.files?.[0] ?? null;
  }

  private static async createFolder(
    drive: drive_v3.Drive,
    name: string,
    parentId: string
  ) {
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [parentId],
      },
      fields: "id,name",
    });

    const folderId = response.data.id;

    if (!folderId) {
      throw new Error("Google Drive folder could not be created");
    }

    return folderId;
  }

  private static async ensureFolderPath(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string
  ) {
    const drive = this.getDriveClient(refreshToken);
    const storageMode = getGoogleDriveStorageMode(userPreferences);
    const spaces = storageMode === "customFolder" ? "drive" : "appDataFolder";
    const baseSegments = getGoogleDriveBaseFolderSegments(userPreferences);
    const folderSegments = [
      ...baseSegments,
      getCloudSyncGameFolderName(shop, objectId),
    ];

    let parentId = storageMode === "customFolder" ? "root" : "appDataFolder";

    for (const segment of folderSegments) {
      const existingFolder = await this.findFolderByName(
        drive,
        segment,
        parentId,
        spaces
      );

      parentId = existingFolder?.id
        ? existingFolder.id
        : await this.createFolder(drive, segment, parentId);
    }

    return { drive, folderId: parentId, spaces };
  }

  private static async findFileByName(
    drive: drive_v3.Drive,
    name: string,
    parentId: string,
    spaces: string
  ) {
    const escapedName = escapeGoogleDriveQueryValue(name);

    const response = await drive.files.list({
      spaces,
      q: [
        `name='${escapedName}'`,
        `'${parentId}' in parents`,
        "trashed=false",
      ].join(" and "),
      fields: "files(id,name,size,createdTime,modifiedTime)",
      pageSize: 1,
    });

    return response.data.files?.[0] ?? null;
  }

  private static async readManifest(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string
  ) {
    const { drive, folderId, spaces } = await this.ensureFolderPath(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );
    const manifestFile = await this.findFileByName(
      drive,
      CLOUD_SYNC_MANIFEST_FILE_NAME,
      folderId,
      spaces
    );

    if (!manifestFile?.id) {
      return {
        drive,
        folderId,
        spaces,
        manifestFileId: null,
        manifest: createEmptyCloudSyncManifest(),
      };
    }

    const response = await drive.files.get(
      {
        fileId: manifestFile.id,
        alt: "media",
      },
      {
        responseType: "stream",
      }
    );

    const responseStream = response.data as unknown as NodeJS.ReadableStream;
    const manifestBuffer = await streamToBuffer(responseStream);
    const manifest = JSON.parse(
      manifestBuffer.toString("utf8")
    ) as CloudSyncManifest;

    return {
      drive,
      folderId,
      spaces,
      manifestFileId: manifestFile.id,
      manifest,
    };
  }

  private static async writeManifest(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string,
    manifest: CloudSyncManifest
  ) {
    const { drive, folderId, manifestFileId } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );
    const manifestBuffer = Buffer.from(
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
    const media = {
      mimeType: "application/json",
      body: Readable.from(manifestBuffer),
    };

    if (manifestFileId) {
      await drive.files.update({
        fileId: manifestFileId,
        media,
      });
      return;
    }

    await drive.files.create({
      requestBody: {
        name: CLOUD_SYNC_MANIFEST_FILE_NAME,
        parents: [folderId],
      },
      media,
      fields: "id",
    });
  }

  public static async listGameArtifacts(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string
  ): Promise<GameArtifact[]> {
    const { manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );

    return manifest.artifacts.map(
      ({
        fileName: _fileName,
        homeDir: _homeDir,
        winePrefixPath: _winePrefixPath,
        ...artifact
      }) => artifact
    );
  }

  public static async uploadGameArtifact(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    params: {
      artifact: CloudSyncStoredArtifact;
      archivePath: string;
      shop: GameShop;
      objectId: string;
    }
  ) {
    const { drive, folderId } = await this.ensureFolderPath(
      refreshToken,
      userPreferences,
      params.shop,
      params.objectId
    );

    await drive.files.create({
      requestBody: {
        name: params.artifact.fileName,
        parents: [folderId],
      },
      media: {
        mimeType: "application/tar",
        body: Readable.from(fs.readFileSync(params.archivePath)),
      },
      fields: "id",
    });

    const { manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      params.shop,
      params.objectId
    );

    manifest.artifacts = [params.artifact, ...manifest.artifacts];

    await this.writeManifest(
      refreshToken,
      userPreferences,
      params.shop,
      params.objectId,
      manifest
    );
  }

  public static async downloadGameArtifact(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string,
    artifactId: string
  ) {
    const { drive, folderId, spaces, manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) {
      throw new Error("Google Drive backup could not be found");
    }

    const remoteFile = await this.findFileByName(
      drive,
      artifact.fileName,
      folderId,
      spaces
    );

    if (!remoteFile?.id) {
      throw new Error("Google Drive backup archive could not be found");
    }

    const response = await drive.files.get(
      {
        fileId: remoteFile.id,
        alt: "media",
      },
      {
        responseType: "stream",
      }
    );

    const archiveBuffer = await streamToBuffer(
      response.data as unknown as NodeJS.ReadableStream
    );

    artifact.downloadCount += 1;
    await this.writeManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId,
      manifest
    );

    return {
      archiveBuffer,
      homeDir: artifact.homeDir,
      winePrefixPath: artifact.winePrefixPath,
    };
  }

  public static async deleteGameArtifact(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string,
    artifactId: string
  ) {
    const { drive, folderId, spaces, manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) return;

    const remoteFile = await this.findFileByName(
      drive,
      artifact.fileName,
      folderId,
      spaces
    );

    if (remoteFile?.id) {
      await drive.files.delete({
        fileId: remoteFile.id,
      });
    }

    manifest.artifacts = manifest.artifacts.filter(
      (entry) => entry.id !== artifactId
    );
    await this.writeManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId,
      manifest
    );
  }

  public static async renameGameArtifact(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string,
    artifactId: string,
    label: string
  ) {
    const { manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) {
      throw new Error("Google Drive backup could not be found");
    }

    artifact.label = label;
    artifact.updatedAt = new Date().toISOString();

    await this.writeManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId,
      manifest
    );
  }

  public static async toggleGameArtifactFreeze(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string,
    artifactId: string,
    freeze: boolean
  ) {
    const { manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) {
      throw new Error("Google Drive backup could not be found");
    }

    artifact.isFrozen = freeze;
    artifact.updatedAt = new Date().toISOString();

    await this.writeManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId,
      manifest
    );
  }

  public static async authenticate() {
    const { clientId, clientSecret, redirectUri } = getGoogleDriveOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    const state = createOAuthState();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent",
      state,
      scope: [
        ...GOOGLE_IDENTITY_SCOPES,
        GOOGLE_DRIVE_SCOPE,
        GOOGLE_DRIVE_FILE_SCOPE,
      ],
    });

    return waitForOAuthCallback({
      provider: PROVIDER_NAME,
      authUrl,
      redirectUri,
      expectedPath: CALLBACK_PATH,
      expectedState: state,
      successHtml:
        "<html><body><h1>Google Drive connected</h1><p>You can close this window and return to Hydra.</p></body></html>",
      failureHtml:
        "<html><body><h1>Google Drive connection failed</h1><p>You can close this window and return to Hydra.</p></body></html>",
      handleCallback: async (callbackUrl) => {
        const callbackError = getGoogleDriveCallbackError(callbackUrl);
        if (callbackError) throw callbackError;

        const code = callbackUrl.searchParams.get("code");
        if (!code) {
          throw new Error("Google Drive OAuth callback did not include a code");
        }

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        if (!tokens.refresh_token) {
          throw new Error("Google did not return a refresh token");
        }

        const oauth2 = google.oauth2({
          version: "v2",
          auth: oauth2Client,
        });

        const userInfo = await oauth2.userinfo.get();
        const accountEmail = userInfo.data.email;

        if (!accountEmail) {
          throw new Error("Google account email was not returned");
        }

        return {
          refreshToken: tokens.refresh_token,
          accountEmail,
        };
      },
    });
  }
}
