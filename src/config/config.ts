import * as dotenv from "dotenv"
dotenv.config()

const config = {
    S3_ENDPOINT: process.env.S3_ENDPOINT!,
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL!,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY!,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY!,
    S3_BUCKET_MEDIA: "uploads",
    S3_BUCKET_PROFILE: "profile-photos"
}

export default config