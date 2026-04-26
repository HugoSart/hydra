import { shell } from "electron";
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";

const LOCAL_REDIRECT_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEFAULT_AUTH_TIMEOUT_MS = 3 * 60 * 1000;

const activeCallbackServers = new Map<string, http.Server>();

export const createOAuthState = () => crypto.randomBytes(24).toString("hex");

const closeServer = async (server: http.Server) => {
  if (!server.listening) return;

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
};

const closeActiveCallbackServer = async (provider: string) => {
  const server = activeCallbackServers.get(provider);
  if (!server) return;

  activeCallbackServers.delete(provider);
  await closeServer(server);
};

const getCallbackServerError = (provider: string, error: unknown) => {
  if (error instanceof Error && "code" in error) {
    const errorCode = (error as NodeJS.ErrnoException).code;

    if (errorCode === "EADDRINUSE") {
      return new Error(
        `${provider} OAuth callback port is already in use. Close the other Hydra process and try again.`
      );
    }

    if (errorCode === "EACCES") {
      return new Error(
        `${provider} OAuth callback port is not available. Check the redirect URI port and try again.`
      );
    }
  }

  return error;
};

export const validateLocalOAuthRedirectUri = (
  provider: string,
  redirectUri: string,
  expectedPath: string
) => {
  const url = new URL(redirectUri);

  if (url.protocol !== "http:") {
    throw new Error(`${provider} OAuth redirect URI must use http`);
  }

  if (!LOCAL_REDIRECT_HOSTS.has(url.hostname)) {
    throw new Error(`${provider} OAuth redirect URI must use a local host`);
  }

  if (!url.port) {
    throw new Error(`${provider} OAuth redirect URI must include a port`);
  }

  if (url.pathname !== expectedPath) {
    throw new Error(
      `${provider} OAuth redirect URI must use the ${expectedPath} callback path`
    );
  }

  return {
    url,
    port: Number(url.port),
  };
};

export interface WaitForOAuthCallbackOptions {
  provider: string;
  authUrl: string;
  redirectUri: string;
  expectedPath: string;
  expectedState: string;
  successHtml: string;
  failureHtml: string;
  timeoutMs?: number;
}

export const waitForOAuthCallback = async <T>({
  provider,
  authUrl,
  redirectUri,
  expectedPath,
  expectedState,
  successHtml,
  failureHtml,
  timeoutMs = DEFAULT_AUTH_TIMEOUT_MS,
  handleCallback,
}: WaitForOAuthCallbackOptions & {
  handleCallback: (callbackUrl: URL) => Promise<T>;
}) => {
  await closeActiveCallbackServer(provider);

  const { url, port } = validateLocalOAuthRedirectUri(
    provider,
    redirectUri,
    expectedPath
  );

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = async (server: http.Server) => {
      if (activeCallbackServers.get(provider) === server) {
        activeCallbackServers.delete(provider);
      }

      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      await closeServer(server);
    };

    const finishWithSuccess = (
      server: http.Server,
      response: http.ServerResponse,
      result: T
    ) => {
      if (settled) return;

      settled = true;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(successHtml);
      resolve(result);
      void cleanup(server);
    };

    const finishWithError = (
      server: http.Server,
      error: unknown,
      response?: http.ServerResponse
    ) => {
      if (settled) return;

      settled = true;

      if (response && !response.headersSent) {
        response.writeHead(500, {
          "Content-Type": "text/html; charset=utf-8",
        });
        response.end(failureHtml);
      } else if (response && !response.writableEnded) {
        response.end();
      }

      reject(getCallbackServerError(provider, error));
      void cleanup(server);
    };

    const server = http.createServer(async (request, response) => {
      try {
        if (!request.url) {
          throw new Error(`${provider} OAuth callback did not include a URL`);
        }

        const callbackUrl = new URL(request.url, url.origin);
        if (callbackUrl.pathname !== expectedPath) {
          response.writeHead(404);
          response.end();
          return;
        }

        const state = callbackUrl.searchParams.get("state");
        if (!state || state !== expectedState) {
          throw new Error(`${provider} OAuth callback state is invalid`);
        }

        const result = await handleCallback(callbackUrl);
        finishWithSuccess(server, response, result);
      } catch (error) {
        finishWithError(server, error, response);
      }
    });

    activeCallbackServers.set(provider, server);

    timeout = setTimeout(() => {
      finishWithError(
        server,
        new Error(`${provider} connection timed out. Please try again.`)
      );
    }, timeoutMs);

    server.once("error", (error) => {
      finishWithError(server, error);
    });

    server.listen(port, url.hostname, async () => {
      try {
        await shell.openExternal(authUrl);
      } catch (error) {
        finishWithError(server, error);
      }
    });
  });
};
