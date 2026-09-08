/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_MICROSOFT_CLIENT_ID?: string;
}

interface Window {
  launchQueue?: {
    setConsumer: (callback: (params: { files: Array<{ getFile: () => Promise<File> }> }) => void) => void;
  };
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (response: {
            access_token?: string;
            expires_in?: number;
            error?: string;
            error_description?: string;
          }) => void;
        }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        revoke: (token: string, done?: () => void) => void;
      };
    };
  };
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
