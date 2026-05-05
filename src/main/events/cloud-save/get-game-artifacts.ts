import { HydraApi, Ludusavi } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameArtifact, GameShop, LudusaviBackupEntry } from "@types";
import {
  getActiveCloudProviderId,
  isHydraCloudProvider,
} from "./cloud-save-provider";

const mapLudusaviBackupToGameArtifact = (
  backup: LudusaviBackupEntry
): GameArtifact => {
  return {
    id: backup.name,
    artifactLengthInBytes: 0,
    downloadOptionTitle: backup.name,
    createdAt: backup.when,
    updatedAt: backup.when,
    hostname: backup.os ?? "Ludusavi",
    downloadCount: 0,
    label: backup.comment ?? undefined,
    isFrozen: backup.locked,
  };
};

const getGameArtifacts = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  if (shop === "custom") {
    return [];
  }

  const activeCloudProviderId = await getActiveCloudProviderId();

  if (!isHydraCloudProvider(activeCloudProviderId)) {
    const backups = await Ludusavi.listGameBackups(objectId);
    return backups.map(mapLudusaviBackupToGameArtifact);
  }

  return HydraApi.get<GameArtifact[]>(
    "/profile/games/artifacts",
    { objectId, shop },
    { needsSubscription: true }
  );
};

registerEvent("getGameArtifacts", getGameArtifacts);
