import { NextRequest, NextResponse } from "next/server";
import { UPLOADS_DIR } from "@/lib/db";
import fs from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate file type
  const allowedTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Supported: mp4, mov, avi, webm` },
      { status: 400 }
    );
  }

  // Validate file size (2GB max)
  const maxSize = 2 * 1024 * 1024 * 1024;
  if (file.size > maxSize) {
    return NextResponse.json({ error: "File exceeds 2GB limit" }, { status: 400 });
  }

  // Save file
  const fileId = crypto.randomUUID();
  const ext = path.extname(file.name) || ".mp4";
  const fileName = `${fileId}${ext}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return NextResponse.json({
    id: fileId,
    fileName: file.name,
    storedName: fileName,
    fileSize: file.size,
    videoUrl: `/api/uploads/${fileName}`,
    uploadedAt: new Date().toISOString(),
  }, { status: 201 });
}
