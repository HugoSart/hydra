import { URL } from "node:url";
import { google } from "googleapis";
import {
  createOAuthState,
  waitForOAuthCallback,
} from "./oauth-callback-server";

const PROVIDER_NAME = "Google Drive";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"];
const DEFAULT_REDIRECT_PORT = 53682;
const CALLBACK_PATH = "/oauth/google/callback";

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

export class GoogleDriveService {
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
      scope: [...GOOGLE_IDENTITY_SCOPES, GOOGLE_DRIVE_SCOPE],
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

  public static async revoke(refreshToken: string) {
    const { clientId, clientSecret, redirectUri } = getGoogleDriveOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    await oauth2Client.revokeToken(refreshToken);
  }
}
