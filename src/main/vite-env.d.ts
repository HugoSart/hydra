/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_API_URL: string;
  readonly MAIN_VITE_ANALYTICS_API_URL: string;
  readonly MAIN_VITE_AUTH_URL: string;
  readonly MAIN_VITE_CHECKOUT_URL: string;
  readonly MAIN_VITE_EXTERNAL_RESOURCES_URL: string;
  readonly MAIN_VITE_WS_URL: string;
  readonly MAIN_VITE_NIMBUS_API_URL: string;
  readonly MAIN_VITE_LAUNCHER_SUBDOMAIN: string;
  readonly MAIN_VITE_CLOUD_SERVICE_GOOGLE_DRIVE_APP_ID?: string;
  readonly MAIN_VITE_CLOUD_SERVICE_GOOGLE_DRIVE_APP_SECRET?: string;
  readonly MAIN_VITE_CLOUD_SERVICE_GOOGLE_DRIVE_REDIRECT_URI?: string;
  readonly MAIN_VITE_CLOUD_SERVICE_DROPBOX_APP_ID?: string;
  readonly MAIN_VITE_CLOUD_SERVICE_DROPBOX_APP_SECRET?: string;
  readonly MAIN_VITE_CLOUD_SERVICE_DROPBOX_REDIRECT_URI?: string;
  readonly ELECTRON_RENDERER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
