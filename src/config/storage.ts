// s3.ts
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from './config';


export const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: "in-wb-1",
    credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
    },
    forcePathStyle: true
});

const publicStorageUrl = new S3Client({
    endpoint: config.S3_PUBLIC_URL!,
    region: "in-wb-1",
    credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
    },
    forcePathStyle: true
});

export async function generatePublicSignedUrl(params: {
    bucket: string;
    key: string;
    expiresIn?: number;
}): Promise<string> {
    const { bucket, key, expiresIn = 7 * 24 * 60 * 60 } = params;

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });

    const signedUrl = await getSignedUrl(publicStorageUrl, command, { expiresIn });
    const url = new URL(signedUrl);
    return url.toString();
}
