import { GoogleDriveService } from "@main/services";
import type { CloudProviderAuthCredentials } from "@shared";
import { registerEvent } from "../register-event";

const authenticateGoogleDrive = async (
  _event: Electron.IpcMainInvokeEvent,
  credentials: CloudProviderAuthCredentials
) => GoogleDriveService.authenticate(credentials);

registerEvent("authenticateGoogleDrive", authenticateGoogleDrive);
