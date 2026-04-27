import fs from "node:fs";
import { Readable } from "node:stream";
import { URL } from "node:url";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { UserPreferences } from "@types";
import type { CloudProviderAuthCredentials } from "@shared";
import {
  decryptCloudProviderSecret,
  encryptCloudProviderSecret,
} from "../cloud-provider-credentials";
import {
  CLOUD_SYNC_MANIFEST_FILE_NAME,
  DEFAULT_EXTERNAL_CLOUD_ROOT_FOLDER,
  type CloudSyncManifest,
  createEmptyCloudSyncManifest,
  getCloudSyncGameFolderName,
} from "../cloud-sync-manifest";
import type { CloudProviderContext } from "../cloud-provider-strategy";
import { ManifestCloudProviderStrategy } from "../manifest-cloud-provider-strategy";
import {
  createOAuthState,
  waitForOAuthCallback,
} from "../oauth-callback-server";

const PROVIDER_NAME = "Google Drive";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"];
const GOOGLE_DRIVE_REQUIRED_SCOPES = [
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
] as const;
const DEFAULT_REDIRECT_PORT = 53682;
const CALLBACK_PATH = "/oauth/google/callback";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const getGoogleDriveOAuthConfig = (
  credentials: CloudProviderAuthCredentials
) => {
  const clientId = credentials.clientId.trim();
  const clientSecret = credentials.clientSecret.trim();
  const redirectUri =
    import.meta.env.MAIN_VITE_GOOGLE_DRIVE_REDIRECT_URI ??
    `http://127.0.0.1:${DEFAULT_REDIRECT_PORT}${CALLBACK_PATH}`;

  if (!clientId || !clientSecret) {
    throw new Error("Google Drive OAuth client is not configured");
  }

  return { clientId, clientSecret, redirectUri };
};

const getGoogleDriveCredentials = (
  userPreferences: UserPreferences | null
): CloudProviderAuthCredentials => ({
  clientId: userPreferences?.googleDriveClientId ?? "",
  clientSecret: userPreferences?.googleDriveClientSecret
    ? decryptCloudProviderSecret(userPreferences.googleDriveClientSecret)
    : "",
});

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

const ensureGoogleDriveScopes = async (
  oauth2Client: InstanceType<typeof google.auth.OAuth2>
) => {
  const accessToken = oauth2Client.credentials.access_token;

  if (!accessToken) {
    throw new Error("Google did not return an access token");
  }

  const tokenInfo = await oauth2Client.getTokenInfo(accessToken);
  const grantedScopes = new Set(tokenInfo.scopes ?? []);
  const missingScopes = GOOGLE_DRIVE_REQUIRED_SCOPES.filter(
    (scope) => !grantedScopes.has(scope)
  );

  if (missingScopes.length) {
    throw new Error(
      `Google Drive connection is missing required permissions: ${missingScopes.join(", ")}`
    );
  }
};

class GoogleDriveProviderStrategy extends ManifestCloudProviderStrategy {
  private createOAuthClient(context: CloudProviderContext) {
    const { clientId, clientSecret, redirectUri } = getGoogleDriveOAuthConfig(
      getGoogleDriveCredentials(context.userPreferences)
    );
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    oauth2Client.setCredentials({ refresh_token: context.refreshToken });
    return oauth2Client;
  }

  private getDriveClient(context: CloudProviderContext) {
    const oauth2Client = this.createOAuthClient(context);

    return google.drive({
      version: "v3",
      auth: oauth2Client,
    });
  }

  private async findFolderByName(
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

  private async createFolder(
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

  private async ensureFolderPath(context: CloudProviderContext) {
    const drive = this.getDriveClient(context);
    const storageMode = getGoogleDriveStorageMode(context.userPreferences);
    const spaces = storageMode === "customFolder" ? "drive" : "appDataFolder";
    const baseSegments = getGoogleDriveBaseFolderSegments(
      context.userPreferences
    );
    const folderSegments = [
      ...baseSegments,
      getCloudSyncGameFolderName(context.shop, context.objectId),
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

  private async findFileByName(
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

  private async readManifestState(context: CloudProviderContext) {
    const { drive, folderId, spaces } = await this.ensureFolderPath(context);
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

  protected async readManifest(context: CloudProviderContext) {
    const { manifest } = await this.readManifestState(context);
    return manifest;
  }

  protected async writeManifest(
    context: CloudProviderContext,
    manifest: CloudSyncManifest
  ) {
    const { drive, folderId, manifestFileId } =
      await this.readManifestState(context);
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

  protected async uploadArchive(
    context: CloudProviderContext,
    fileName: string,
    archivePath: string
  ) {
    const { drive, folderId } = await this.ensureFolderPath(context);

    await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: "application/tar",
        body: Readable.from(fs.readFileSync(archivePath)),
      },
      fields: "id",
    });
  }

  protected async downloadArchive(
    context: CloudProviderContext,
    fileName: string
  ) {
    const { drive, folderId, spaces } = await this.readManifestState(context);
    const remoteFile = await this.findFileByName(
      drive,
      fileName,
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

    return archiveBuffer;
  }

  protected async deleteArchive(
    context: CloudProviderContext,
    fileName: string
  ) {
    const { drive, folderId, spaces } = await this.readManifestState(context);
    const remoteFile = await this.findFileByName(
      drive,
      fileName,
      folderId,
      spaces
    );

    if (remoteFile?.id) {
      await drive.files.delete({
        fileId: remoteFile.id,
      });
    }
  }
}

export const googleDriveProviderStrategy = new GoogleDriveProviderStrategy();

export class GoogleDriveService {
  public static async authenticate(credentials: CloudProviderAuthCredentials) {
    const { clientId, clientSecret, redirectUri } =
      getGoogleDriveOAuthConfig(credentials);
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

        await ensureGoogleDriveScopes(oauth2Client);

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
          clientSecret: encryptCloudProviderSecret(clientSecret),
        };
      },
    });
  }
}
