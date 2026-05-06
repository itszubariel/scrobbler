export async function uploadToSupabase(
  buffer: Buffer,
  bucket: string,
  filename: string,
): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${filename}`;

  try {
    console.log(`Uploading to ${bucket}/${filename}`);

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "image/png",
        "x-upsert": "true",
      },
      body: buffer as unknown as BodyInit,
    });

    console.log(`Upload response status: ${res.status}`);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `Supabase upload failed [${bucket}/${filename}]: ${res.status} ${text}`,
      );
    }

    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filename}`;
  } catch (error) {
    console.error(
      `Supabase upload error [${bucket}/${filename}]:`,
      error instanceof Error ? error.message : String(error),
    );
    // Return the URL anyway so the command doesn't fail completely
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filename}`;
  }
}
