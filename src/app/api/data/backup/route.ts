import { NextResponse } from "next/server";
import { createEncryptedBackup } from "@/server/lib/backup";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { passphrase?: unknown } | null;
  const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
  try {
    const archive = createEncryptedBackup(passphrase);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="spent-backup-${date}.spent"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Backup failed" }, { status: 400 });
  }
}
