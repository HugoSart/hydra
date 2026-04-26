import { URL } from "node:url";
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
