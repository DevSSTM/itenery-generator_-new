import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicImagesDir = path.join(__dirname, 'public', 'images');
const outputFile = path.join(__dirname, 'src', 'gallery_data.json');

// Map encoded IDs (from data.js) to Folder Names in public/images
const idToFolderMap = {
    'colombo': 'colombo',
    'negombo': 'Negombo',
    'kandy': 'Kandy',
    'nuwara-eliya': 'Nuwara eliya',
    'galle': 'Galle',
    'bentota': 'Bentota',
    'dambulla': 'Dambulla',
    'sigiriya': 'Sigiriya',
    'ella': 'Ella',
    'yala': 'Yala',
    'trincomalee': 'Trincomalee',
    'jaffna': 'Jaffna',
    'kitulgala': 'Kithulgala',
    'mirissa': 'Mirissa'
};

const galleryData = {};

Object.entries(idToFolderMap).forEach(([id, folderName]) => {
    const dirPath = path.join(publicImagesDir, folderName);

    if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        const images = files
            .filter(file => /\.(jpg|jpeg|png|webp|gif)$/i.test(file))
            .map(file => `/images/${folderName}/${file}`);

        if (images.length > 0) {
            galleryData[id] = images;
            console.log(`Found ${images.length} images for ${id} (Folder: ${folderName})`);
        } else {
            galleryData[id] = [];
            console.log(`No images found for ${id} (Folder: ${folderName})`);
        }
    } else {
        console.warn(`Directory not found: ${dirPath}`);
        galleryData[id] = [];
    }
});

fs.writeFileSync(outputFile, JSON.stringify(galleryData, null, 2));
console.log(`Gallery data written to ${outputFile}`);
