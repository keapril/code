import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

const R2_JSON_PATH = "medical_products.json";
const R2_METADATA_PATH = "metadata.json";

export async function POST(request: Request) {
    try {
        const payload = await request.json();
        const { data, fileName } = payload;

        if (!data || !Array.isArray(data)) {
            return NextResponse.json({ error: '無效的資料格式' }, { status: 400 });
        }

        let accessKeyId = process.env.ACCESS_KEY;
        let secretAccessKey = process.env.SECRET_KEY;
        let endpoint = process.env.ENDPOINT_URL; // e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com
        let bucketName = process.env.BUCKET_NAME;

        // Try getting environment variables from Cloudflare Pages context
        if (!accessKeyId) {
            try {
                const ctx = getRequestContext();
                accessKeyId = (ctx.env as any).ACCESS_KEY;
                secretAccessKey = (ctx.env as any).SECRET_KEY;
                endpoint = (ctx.env as any).ENDPOINT_URL;
                bucketName = (ctx.env as any).BUCKET_NAME;
            } catch (e) {
                // Ignore context error
            }
        }

        if (!accessKeyId || !secretAccessKey || !endpoint || !bucketName) {
            return NextResponse.json({ 
                error: 'R2 環境變數未完全設定，請至 Cloudflare 中設定 ACCESS_KEY, SECRET_KEY, ENDPOINT_URL, BUCKET_NAME' 
            }, { status: 500 });
        }

        const client = new S3Client({
            region: 'auto',
            endpoint: endpoint,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });

        // 台灣時區 (UTC+8) 作為更新時間
        const updateDate = new Date(Date.now() + 8 * 3600000);
        const updatedAt = updateDate.toISOString().replace('T', ' ').slice(0, 16);

        // 1. 存 JSON 檔
        const jsonContent = JSON.stringify(data);
        await client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: R2_JSON_PATH,
            Body: jsonContent,
            ContentType: 'application/json; charset=utf-8'
        }));

        // 2. 存 Metadata
        const metadata = {
            updated_at: updatedAt,
            file_name: fileName || 'unknown',
            record_count: data.length
        };
        
        await client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: R2_METADATA_PATH,
            Body: JSON.stringify(metadata),
            ContentType: 'application/json'
        }));

        return NextResponse.json({ success: true, count: data.length, updatedAt });

    } catch (error: any) {
        console.error('上傳至 R2 發生錯誤:', error);
        return NextResponse.json({ error: '上傳至 R2 失敗', details: error.message }, { status: 500 });
    }
}
