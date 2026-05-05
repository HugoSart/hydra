import { spawnSync } from "node:child_process";

export const isRCloneAvailable = (): boolean => {
  const result = spawnSync("rclone", ["--version"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error && result.status === 0;
};
