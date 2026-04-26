import { GoogleDriveService } from "@main/services";
import { registerEvent } from "../register-event";

const authenticateGoogleDrive = async () => GoogleDriveService.authenticate();

registerEvent("authenticateGoogleDrive", authenticateGoogleDrive);
