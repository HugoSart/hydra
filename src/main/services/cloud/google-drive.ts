import { shell } from "electron";
import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";

const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"];
const DEFAULT_REDIRECT_PORT = 53682;
const CALLBACK_PATH = "/oauth/google/callback";

let activeAuthServer: http.Server | null = null;

const closeActiveAuthServer = async () => {
  if (!activeAuthServer) return;

  const server = activeAuthServer;
  activeAuthServer = null;

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
};

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

const getRedirectPort = (redirectUri: string) => {
  const url = new URL(redirectUri);
  const port = Number(url.port);

  if (!port) {
    throw new Error("Google Drive OAuth redirect URI must include a port");
  }

  return port;
};

export class GoogleDriveService {
  public static async authenticate() {
    await closeActiveAuthServer();

    const { clientId, clientSecret, redirectUri } =
      getGoogleDriveOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    const callbackPath = new URL(redirectUri).pathname;
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent",
      scope: [...GOOGLE_IDENTITY_SCOPES, GOOGLE_DRIVE_SCOPE],
    });

    return new Promise<{
      refreshToken: string;
      accountEmail: string;
    }>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        if (activeAuthServer === server) {
          activeAuthServer = null;
        }

        server.close();
      };

      const finishWithSuccess = (result: {
        refreshToken: string;
        accountEmail: string;
      }) => {
        if (settled) return;
        settled = true;
        resolve(result);
        cleanup();
      };

      const finishWithError = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
        cleanup();
      };

      const server = http.createServer(async (request, response) => {
        try {
          if (!request.url) return;

          const requestUrl = new URL(request.url, redirectUri);
          if (requestUrl.pathname !== callbackPath) {
            response.writeHead(404);
            response.end();
            return;
          }

          const error = requestUrl.searchParams.get("error");
          if (error) {
            throw new Error(error);
          }

          const code = requestUrl.searchParams.get("code");
          if (!code) {
            throw new Error(
              "Google Drive OAuth callback did not include a code"
            );
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

          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
          });
          response.end(
            "<html><body><h1>Google Drive connected</h1><p>You can close this window and return to Hydra.</p></body></html>"
          );

          finishWithSuccess({
            refreshToken: tokens.refresh_token,
            accountEmail,
          });
        } catch (error) {
          response.writeHead(500, {
            "Content-Type": "text/html; charset=utf-8",
          });
          response.end(
            "<html><body><h1>Google Drive connection failed</h1><p>You can close this window and return to Hydra.</p></body></html>"
          );
          finishWithError(error);
        }
      });

      activeAuthServer = server;

      server.once("error", (error) => {
        activeAuthServer = null;
        finishWithError(error);
      });

      server.listen(getRedirectPort(redirectUri), "127.0.0.1", async () => {
        try {
          await shell.openExternal(authUrl);
        } catch (error) {
          finishWithError(error);
        }
      });
    });
  }
}
