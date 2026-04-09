import { NextResponse } from 'next/server';
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET_NAME, DATA_KEY, META_KEY } from '@/lib/s3';

export const runtime = 'edge'; // 使用 Edge Runtime 以獲得最佳效能

async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

export async function GET() {
  if (!BUCKET_NAME) {
    return NextResponse.json({ error: "R2 configuration missing" }, { status: 500 });
  }

  try {
    // 1. 抓取中繼資料
    const metaCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: META_KEY,
    });
    
    // 2. 抓取主要資料
    const dataCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: DATA_KEY,
    });

    const metaRes = await s3Client.send(metaCommand);
    const dataRes = await s3Client.send(dataCommand);

    const metaStr = await streamToString(metaRes.Body as ReadableStream);
    const dataStr = await streamToString(dataRes.Body as ReadableStream);

    return NextResponse.json({
      metadata: JSON.parse(metaStr),
      data: JSON.parse(dataStr)
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("R2 Fetch Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
