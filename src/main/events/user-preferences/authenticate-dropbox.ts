import { DropboxService } from "@main/services";
import { registerEvent } from "../register-event";

const authenticateDropbox = async () => DropboxService.authenticate();

registerEvent("authenticateDropbox", authenticateDropbox);
