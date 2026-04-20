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

        let accessKeyId = process.env.R2_ACCESS_KEY_ID;
        let secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
        let endpoint = process.env.R2_ENDPOINT_URL; // e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com
        let bucketName = process.env.R2_BUCKET_NAME;

        // Try getting environment variables from Cloudflare Pages context
        if (!accessKeyId) {
            try {
                const ctx = getRequestContext();
                accessKeyId = (ctx.env as any).R2_ACCESS_KEY_ID || accessKeyId;
                secretAccessKey = (ctx.env as any).R2_SECRET_ACCESS_KEY || secretAccessKey;
                endpoint = (ctx.env as any).R2_ENDPOINT_URL || endpoint;
                bucketName = (ctx.env as any).R2_BUCKET_NAME || bucketName;
            } catch (e) {
                // Ignore context error
            }
        }

        const missingVars = [];
        if (!accessKeyId) missingVars.push('R2_ACCESS_KEY_ID');
        if (!secretAccessKey) missingVars.push('R2_SECRET_ACCESS_KEY');
        if (!endpoint) missingVars.push('R2_ENDPOINT_URL');
        if (!bucketName) missingVars.push('R2_BUCKET_NAME');

        if (missingVars.length > 0) {
            return NextResponse.json({ 
                error: `R2 環境變數遺失: ${missingVars.join(', ')}。請至 Cloudflare 中確認這些變數名稱是否正確設置。` 
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
