import { isRCloneAvailable } from "@main/helpers/is-rclone-available";
import { registerEvent } from "../register-event";

const isRcloneAvailable = async (_event: Electron.IpcMainInvokeEvent) =>
  isRCloneAvailable();

registerEvent("isRcloneAvailable", isRcloneAvailable);
