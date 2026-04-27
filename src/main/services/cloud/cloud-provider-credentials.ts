import { safeStorage } from "electron";

const ENCRYPTED_SECRET_PREFIX = "safeStorage:";

export const encryptCloudProviderSecret = (secret: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is not available on this device");
  }

  return `${ENCRYPTED_SECRET_PREFIX}${safeStorage.encryptString(secret).toString("base64")}`;
};

export const decryptCloudProviderSecret = (encryptedSecret: string) => {
  if (!encryptedSecret.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    return encryptedSecret;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is not available on this device");
  }

  try {
    return safeStorage.decryptString(
      Buffer.from(
        encryptedSecret.slice(ENCRYPTED_SECRET_PREFIX.length),
        "base64"
      )
    );
  } catch {
    throw new Error("Cloud provider secret could not be decrypted");
  }
};
