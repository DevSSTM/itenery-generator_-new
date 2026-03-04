import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const imagesDir = path.join(__dirname, 'public', 'images');
const MAX_WIDTH = 1200;
const QUALITY = 80;

async function processDirectory(directory) {
    try {
        const files = fs.readdirSync(directory);

        for (const file of files) {
            const filePath = path.join(directory, file);
            const stats = fs.statSync(filePath);

            if (stats.isDirectory()) {
                await processDirectory(filePath);
            } else if (/\.(jpg|jpeg|png|webp)$/i.test(file)) {
                await optimizeImage(filePath);
            }
        }
    } catch (err) {
        console.error(`Error processing directory ${directory}:`, err);
    }
}

async function optimizeImage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);
    const outputFilePath = path.join(path.dirname(filePath), `${basename}.webp`);

    // Check if we are overwriting: if ext is .webp, we overwrite. If not, we create .webp and delete original.
    const tempFile = `${outputFilePath}.temp.webp`;

    try {
        console.log(`Processing: ${filePath}`);
        const metadata = await sharp(filePath).metadata();

        let pipeline = sharp(filePath);

        if (metadata.width > MAX_WIDTH) {
            pipeline = pipeline.resize({ width: MAX_WIDTH });
        }

        await pipeline
            .webp({ quality: QUALITY })
            .toFile(tempFile);

        // If conversion successful
        if (ext !== '.webp') {
            fs.unlinkSync(filePath); // Delete original
            console.log(`Deleted original: ${filePath}`);
        }

        // Rename temp to final
        // If outputFilePath exists (e.g. overwriting existing webp), this replaces it
        fs.renameSync(tempFile, outputFilePath);
        console.log(`Optimized: ${outputFilePath}`);

    } catch (err) {
        console.error(`Failed to optimize ${filePath}:`, err);
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
}

console.log('Starting image optimization...');
processDirectory(imagesDir)
    .then(() => console.log('Image optimization complete!'))
    .catch(err => console.error('Fatal error:', err));
