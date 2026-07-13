import "server-only";

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SERVICE = "Spent encryption key";
const ACCOUNT = process.env.USERNAME ?? process.env.USER ?? "local-user";
const DPAPI_PATH = path.join(process.cwd(), "data", ".encryption-key.dpapi");

export type SecretBackend = "dpapi" | "keychain" | "secret-service" | "file";

export function readSystemSecret(): { value: string; backend: SecretBackend } | null {
  try {
    if (process.platform === "win32" && fs.existsSync(DPAPI_PATH)) {
      const script = [
        "$raw=[Console]::In.ReadToEnd().Trim()",
        "$bytes=[Convert]::FromBase64String($raw)",
        "$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
      ].join("; ");
      const value = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        input: fs.readFileSync(DPAPI_PATH, "utf8"),
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      return value ? { value, backend: "dpapi" } : null;
    }
    if (process.platform === "darwin") {
      const value = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"], {
        encoding: "utf8",
      }).trim();
      return value ? { value, backend: "keychain" } : null;
    }
    if (process.platform === "linux") {
      const value = execFileSync("secret-tool", ["lookup", "service", "spent", "account", ACCOUNT], {
        encoding: "utf8",
      }).trim();
      return value ? { value, backend: "secret-service" } : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function writeSystemSecret(value: string): SecretBackend | null {
  try {
    if (process.platform === "win32") {
      const script = [
        "$raw=[Console]::In.ReadToEnd()",
        "$bytes=[Text.Encoding]::UTF8.GetBytes($raw)",
        "$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Console]::Out.Write([Convert]::ToBase64String($protected))",
      ].join("; ");
      const protectedValue = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { input: value, encoding: "utf8", windowsHide: true }
      );
      fs.mkdirSync(path.dirname(DPAPI_PATH), { recursive: true });
      fs.writeFileSync(DPAPI_PATH, protectedValue, { mode: 0o600 });
      return "dpapi";
    }
    if (process.platform === "darwin") {
      execFileSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", value]);
      return "keychain";
    }
    if (process.platform === "linux") {
      execFileSync(
        "secret-tool",
        ["store", "--label", SERVICE, "service", "spent", "account", ACCOUNT],
        { input: value }
      );
      return "secret-service";
    }
  } catch {
    return null;
  }
  return null;
}
