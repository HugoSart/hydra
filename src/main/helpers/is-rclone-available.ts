import fs from "node:fs";
import path from "node:path";

const getExecutableNames = (command: string) => {
  if (process.platform !== "win32" || path.extname(command)) {
    return [command];
  }

  const pathExtensions = process.env.PATHEXT?.split(path.delimiter).filter(
    Boolean
  ) ?? [".COM", ".EXE", ".BAT", ".CMD"];

  return pathExtensions.map((extension) => `${command}${extension}`);
};

export const isRCloneAvailable = (): boolean => {
  const pathDirectories = process.env.PATH?.split(path.delimiter).filter(
    Boolean
  );

  if (!pathDirectories) {
    return false;
  }

  return pathDirectories.some((directory) =>
    getExecutableNames("rclone").some((executableName) => {
      try {
        fs.accessSync(path.join(directory, executableName), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    })
  );
};
