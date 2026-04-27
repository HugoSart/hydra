import { URL } from "node:url";
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

const PROVIDER_NAME = "Dropbox";
const DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_TOKEN_URL = "https://api.dropbox.com/oauth2/token";
const DROPBOX_API_URL = "https://api.dropboxapi.com/2";
const DROPBOX_SCOPES = [
  "account_info.read",
  "files.content.read",
  "files.content.write",
  "files.metadata.read",
];
const DEFAULT_REDIRECT_PORT = 53683;
const CALLBACK_PATH = "/oauth/dropbox/callback";

interface DropboxTokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

interface DropboxAccountResponse {
  account_id: string;
  email?: string;
  name?: {
    display_name?: string;
  };
}

interface DropboxMetadataResponse {
  error_summary?: string;
}

const getDropboxOAuthConfig = () => {
  const clientId = import.meta.env.MAIN_VITE_DROPBOX_APP_KEY;
  const clientSecret = import.meta.env.MAIN_VITE_DROPBOX_APP_SECRET;
  const redirectUri =
    import.meta.env.MAIN_VITE_DROPBOX_REDIRECT_URI ??
    `http://127.0.0.1:${DEFAULT_REDIRECT_PORT}${CALLBACK_PATH}`;

  if (!clientId || !clientSecret) {
    throw new Error("Dropbox OAuth app is not configured");
  }

  return { clientId, clientSecret, redirectUri };
};

const getDropboxCallbackError = (callbackUrl: URL) => {
  const error = callbackUrl.searchParams.get("error");
  if (!error) return null;

  if (error === "access_denied") {
    return new Error("Dropbox connection was canceled");
  }

  return new Error(`Dropbox connection failed: ${error}`);
};

const normalizeDropboxPath = (value: string) =>
  value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");

const getDropboxStorageMode = (userPreferences: UserPreferences | null) =>
  userPreferences?.dropboxStorageMode ?? "appData";

const getDropboxBasePathSegments = (
  userPreferences: UserPreferences | null
) => {
  const storageMode = getDropboxStorageMode(userPreferences);

  if (storageMode === "customFolder") {
    const customPath = normalizeDropboxPath(
      userPreferences?.dropboxCustomPath ?? ""
    );

    if (!customPath) {
      throw new Error("Dropbox custom path is not configured");
    }

    return customPath.split("/");
  }

  return [DEFAULT_EXTERNAL_CLOUD_ROOT_FOLDER];
};

const joinDropboxPath = (...segments: string[]) => {
  const normalized = segments
    .map((segment) => normalizeDropboxPath(segment))
    .filter(Boolean)
    .join("/");

  return normalized ? `/${normalized}` : "";
};

const parseDropboxError = async (
  response: Response,
  fallbackMessage: string
) => {
  const responseText = await response.text();

  if (!responseText) {
    return `${fallbackMessage} (${response.status})`;
  }

  try {
    const json = JSON.parse(responseText) as {
      error?: string;
      error_description?: string;
      error_summary?: string;
    };

    return (
      json.error_description ??
      json.error_summary ??
      json.error ??
      `${fallbackMessage} (${response.status})`
    );
  } catch {
    return `${fallbackMessage}: ${responseText}`;
  }
};

const exchangeDropboxCodeForToken = async (
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
) => {
  const tokenResponse = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(
      await parseDropboxError(
        tokenResponse,
        "Dropbox did not return an access token"
      )
    );
  }

  const tokens = (await tokenResponse.json()) as DropboxTokenResponse;

  if (!tokens.refresh_token) {
    throw new Error("Dropbox did not return a refresh token");
  }

  if (!tokens.access_token) {
    throw new Error("Dropbox did not return an access token");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
};

const getDropboxAccount = async (accessToken: string) => {
  const accountResponse = await fetch(
    `${DROPBOX_API_URL}/users/get_current_account`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!accountResponse.ok) {
    throw new Error(
      await parseDropboxError(
        accountResponse,
        "Dropbox account details could not be loaded"
      )
    );
  }

  return (await accountResponse.json()) as DropboxAccountResponse;
};

export class DropboxService {
  private static getDropboxGameFolderPath(
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string
  ) {
    return joinDropboxPath(
      ...getDropboxBasePathSegments(userPreferences),
      getCloudSyncGameFolderName(shop, objectId)
    );
  }

  private static async getAccessToken(refreshToken: string) {
    const { clientId, clientSecret } = getDropboxOAuthConfig();

    const tokenResponse = await fetch(DROPBOX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(
        await parseDropboxError(
          tokenResponse,
          "Dropbox did not return an access token"
        )
      );
    }

    const tokens = (await tokenResponse.json()) as DropboxTokenResponse;

    if (!tokens.access_token) {
      throw new Error("Dropbox did not return an access token");
    }

    return tokens.access_token;
  }

  private static async rpcRequest<T>(
    accessToken: string,
    endpoint: string,
    body: Record<string, unknown>
  ) {
    const response = await fetch(`${DROPBOX_API_URL}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        await parseDropboxError(response, "Dropbox request failed")
      );
    }

    return (await response.json()) as T;
  }

  private static async getMetadata(
    accessToken: string,
    path: string
  ): Promise<DropboxMetadataResponse | null> {
    const response = await fetch(`${DROPBOX_API_URL}/files/get_metadata`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path }),
    });

    if (response.status === 409) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        await parseDropboxError(response, "Dropbox metadata request failed")
      );
    }

    return (await response.json()) as DropboxMetadataResponse;
  }

  private static async ensureFolderPath(accessToken: string, path: string) {
    const segments = normalizeDropboxPath(path).split("/").filter(Boolean);
    let currentPath = "";

    for (const segment of segments) {
      currentPath = joinDropboxPath(currentPath, segment);
      const existingFolder = await this.getMetadata(accessToken, currentPath);

      if (!existingFolder) {
        await this.rpcRequest(accessToken, "/files/create_folder_v2", {
          path: currentPath,
          autorename: false,
        });
      }
    }
  }

  private static async downloadFileBuffer(accessToken: string, path: string) {
    const response = await fetch(
      "https://content.dropboxapi.com/2/files/download",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Dropbox-API-Arg": JSON.stringify({ path }),
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        await parseDropboxError(response, "Dropbox file download failed")
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private static async uploadFileBuffer(
    accessToken: string,
    path: string,
    buffer: Buffer
  ) {
    const response = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            path,
            mode: "overwrite",
            autorename: false,
            mute: true,
          }),
        },
        body: new Uint8Array(buffer),
      }
    );

    if (!response.ok) {
      throw new Error(
        await parseDropboxError(response, "Dropbox file upload failed")
      );
    }
  }

  private static async readManifest(
    refreshToken: string,
    userPreferences: UserPreferences | null,
    shop: GameShop,
    objectId: string
  ) {
    const accessToken = await this.getAccessToken(refreshToken);
    const folderPath = this.getDropboxGameFolderPath(
      userPreferences,
      shop,
      objectId
    );

    await this.ensureFolderPath(accessToken, folderPath);

    const manifestPath = joinDropboxPath(
      folderPath,
      CLOUD_SYNC_MANIFEST_FILE_NAME
    );
    const manifestMetadata = await this.getMetadata(accessToken, manifestPath);

    if (!manifestMetadata) {
      return {
        accessToken,
        folderPath,
        manifestPath,
        manifest: createEmptyCloudSyncManifest(),
      };
    }

    const manifestBuffer = await this.downloadFileBuffer(
      accessToken,
      manifestPath
    );
    const manifest = JSON.parse(
      manifestBuffer.toString("utf8")
    ) as CloudSyncManifest;

    return {
      accessToken,
      folderPath,
      manifestPath,
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
    const { accessToken, manifestPath } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );

    await this.uploadFileBuffer(
      accessToken,
      manifestPath,
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8")
    );
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
      archiveBuffer: Buffer;
      shop: GameShop;
      objectId: string;
    }
  ) {
    const { accessToken, folderPath, manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      params.shop,
      params.objectId
    );
    const archivePath = joinDropboxPath(folderPath, params.artifact.fileName);

    await this.uploadFileBuffer(accessToken, archivePath, params.archiveBuffer);

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
    const { accessToken, folderPath, manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) {
      throw new Error("Dropbox backup could not be found");
    }

    const archiveBuffer = await this.downloadFileBuffer(
      accessToken,
      joinDropboxPath(folderPath, artifact.fileName)
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
    const { accessToken, folderPath, manifest } = await this.readManifest(
      refreshToken,
      userPreferences,
      shop,
      objectId
    );
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === artifactId
    );

    if (!artifact) return;

    await this.rpcRequest(accessToken, "/files/delete_v2", {
      path: joinDropboxPath(folderPath, artifact.fileName),
    });

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
      throw new Error("Dropbox backup could not be found");
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
      throw new Error("Dropbox backup could not be found");
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
    const { clientId, clientSecret, redirectUri } = getDropboxOAuthConfig();
    const state = createOAuthState();
    const authUrl = new URL(DROPBOX_AUTHORIZE_URL);

    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("token_access_type", "offline");
    authUrl.searchParams.set("scope", DROPBOX_SCOPES.join(" "));
    authUrl.searchParams.set("include_granted_scopes", "user");

    return waitForOAuthCallback({
      provider: PROVIDER_NAME,
      authUrl: authUrl.toString(),
      redirectUri,
      expectedPath: CALLBACK_PATH,
      expectedState: state,
      successHtml:
        "<html><body><h1>Dropbox connected</h1><p>You can close this window and return to Hydra.</p></body></html>",
      failureHtml:
        "<html><body><h1>Dropbox connection failed</h1><p>You can close this window and return to Hydra.</p></body></html>",
      handleCallback: async (callbackUrl) => {
        const callbackError = getDropboxCallbackError(callbackUrl);
        if (callbackError) throw callbackError;

        const code = callbackUrl.searchParams.get("code");
        if (!code) {
          throw new Error("Dropbox OAuth callback did not include a code");
        }

        const tokens = await exchangeDropboxCodeForToken(
          code,
          redirectUri,
          clientId,
          clientSecret
        );
        const account = await getDropboxAccount(tokens.accessToken);
        const accountEmail =
          account.email ?? account.name?.display_name ?? account.account_id;

        return {
          refreshToken: tokens.refreshToken,
          accountEmail,
        };
      },
    });
  }
}
