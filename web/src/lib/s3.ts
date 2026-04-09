import { S3Client } from "@aws-sdk/client-s3";

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT_URL = process.env.R2_ENDPOINT_URL;

export const s3Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || "",
    secretAccessKey: R2_SECRET_ACCESS_KEY || "",
  },
});

export const BUCKET_NAME = process.env.R2_BUCKET_NAME;
export const DATA_KEY = "medical_products.json";
export const META_KEY = "metadata.json";
