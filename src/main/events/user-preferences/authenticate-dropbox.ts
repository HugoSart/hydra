import { DropboxService } from "@main/services";
import type { CloudProviderAuthCredentials } from "@shared";
import { registerEvent } from "../register-event";

const authenticateDropbox = async (
  _event: Electron.IpcMainInvokeEvent,
  credentials: CloudProviderAuthCredentials
) => DropboxService.authenticate(credentials);

registerEvent("authenticateDropbox", authenticateDropbox);
