import { NextResponse } from "next/server";
import { stageEncryptedRestore } from "@/server/lib/backup";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("archive");
    const passphrase = form.get("passphrase");
    if (!(file instanceof File) || typeof passphrase !== "string") {
      return NextResponse.json({ error: "Archive and password are required" }, { status: 400 });
    }
    if (file.size > 250 * 1024 * 1024) {
      return NextResponse.json({ error: "Backup is too large" }, { status: 413 });
    }
    stageEncryptedRestore(Buffer.from(await file.arrayBuffer()), passphrase);
    return NextResponse.json({ ok: true, restartRequired: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Restore failed" }, { status: 400 });
  }
}
