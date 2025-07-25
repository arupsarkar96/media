import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import cors from 'cors';
import { promisify } from 'util';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import config from './config/config';
import { auth } from './middleware/auth';
import { generatePublicSignedUrl, s3 } from './config/storage';

const unlinkAsync = promisify(fs.unlink);
const upload = multer({ dest: 'uploads/' });

const app = express();
app.use(cors());
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(auth);

// 🔍 Logging with IP
morgan.token(
    'real-ip',
    (req: any) => req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
);

app.use(morgan(':real-ip :method :url :status :response-time ms [:date]'));

const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/webm',
    'application/pdf',
];

const getExtensionFromMime = (mimetype: string): string => {
    const map: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/webm': '.webm',
        'audio/mpeg': '.mp3',
        'audio/webm': '.webm',
        'application/pdf': '.pdf',
    };
    return map[mimetype] || '.bin';
};

const safeUnlink = async (filePath: string) => {
    try {
        await unlinkAsync(filePath);
    } catch (_) { }
};

// ✅ Generic upload handler
const handleUpload = async (
    req: Request,
    res: Response,
    bucket: string,
    keyGenerator: (file: Express.Multer.File, req: Request) => string,
    generateUrl: (key: string) => Promise<string>,
) => {
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!allowedMimeTypes.includes(file.mimetype)) {
        await safeUnlink(file.path);
        return res.status(400).json({ error: 'Unsupported file type' });
    }

    const key = keyGenerator(file, req);

    try {
        await s3.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: fs.createReadStream(file.path),
                ContentType: file.mimetype,
                CacheControl: 'public, max-age=31536000',
            }),
        );

        await safeUnlink(file.path);

        const url = await generateUrl(key);

        res.json({
            media_url: url,
            key,
            size: file.size,
            type: file.mimetype,
        });
    } catch (err) {
        console.error('Upload failed:', err);
        await safeUnlink(file.path);
        res.status(500).json({ error: 'Upload failed' });
    }
};

// 🎯 Upload general media
app.post(
    '/upload/media',
    upload.fields([
        { name: 'file', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 }, // optional
    ]),
    async (req, res) => {

        const files = req.files as {
            file?: Express.Multer.File[];
            thumbnail?: Express.Multer.File[];
        };

        const mainFile = files?.file?.[0];
        const thumbFile = files?.thumbnail?.[0];

        if (!mainFile) {
            return res.status(400).json({ error: "Missing file" });
        }

        const mainKey = `${req.headers["x-user"]}/${uuidv4()}${getExtensionFromMime(mainFile.mimetype)}`;
        const thumbKey = thumbFile
            ? `${req.headers["x-user"]}/thumbs/${uuidv4()}${getExtensionFromMime(thumbFile.mimetype)}`
            : null;

        try {
            // Upload main file
            await s3.send(
                new PutObjectCommand({
                    Bucket: config.S3_BUCKET_MEDIA,
                    Key: mainKey,
                    Body: fs.createReadStream(mainFile.path),
                    ContentType: mainFile.mimetype,
                    CacheControl: "public, max-age=31536000",
                })
            );
            await safeUnlink(mainFile.path);

            // Upload thumbnail if provided
            if (thumbFile && allowedMimeTypes.includes(thumbFile.mimetype)) {
                await s3.send(
                    new PutObjectCommand({
                        Bucket: config.S3_BUCKET_MEDIA,
                        Key: thumbKey!,
                        Body: fs.createReadStream(thumbFile.path),
                        ContentType: thumbFile.mimetype,
                        CacheControl: "public, max-age=31536000",
                    })
                );
                await safeUnlink(thumbFile.path);
            }

            const mediaUrl = await generatePublicSignedUrl({
                bucket: config.S3_BUCKET_MEDIA,
                key: mainKey,
            });

            const thumbnailUrl = thumbKey
                ? await generatePublicSignedUrl({
                    bucket: config.S3_BUCKET_MEDIA,
                    key: thumbKey,
                })
                : null;

            return res.json({
                success: true,
                media_url: mediaUrl,
                thumbnail_url: thumbnailUrl,
                type: mainFile.mimetype,
                size: mainFile.size,
            });
        } catch (err) {
            console.error("Upload error:", err);
            await safeUnlink(mainFile.path);
            if (thumbFile) await safeUnlink(thumbFile.path);
            return res.status(500).json({ error: "Upload failed" });
        }


        // await handleUpload(
        //     req,
        //     res,
        //     config.S3_BUCKET_MEDIA,
        //     (file) => `${req.headers['x-user']}/${uuidv4()}${getExtensionFromMime(file.mimetype)}`,
        //     async (key) => generatePublicSignedUrl({ bucket: config.S3_BUCKET_MEDIA, key }),
        // );
    },
);

// 👤 Upload user profile picture (overwrites)
app.post('/upload/profile', upload.single('file'), async (req, res) => {
    const user = req.headers['x-user'] as string;
    if (!user) {
        return res.status(400).json({ error: 'Missing x-user header' });
    }

    await handleUpload(
        req,
        res,
        config.S3_BUCKET_PROFILE,
        (file) => `${user}${getExtensionFromMime(file.mimetype)}`,
        async (key) =>
            `${config.S3_PUBLIC_URL}/${config.S3_BUCKET_PROFILE}/${key}?etag=${uuidv4()}`,
    );
});

// 🩺 Health check
app.get('/upload/health', (_, res) => res.send('OK'));

// 🧯 Centralized error handler
app.use((err: any, _: Request, res: Response, __: NextFunction) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(8080, '0.0.0.0', () => {
    console.log('🚀 Server hosted on port', 8080);
});
