import {
  MAX_WORKSHOP_MATERIAL_SOURCE_DATA_URL_LENGTH,
  MAX_WORKSHOP_MATERIAL_TOTAL_SOURCE_LENGTH,
} from './ProceduralWorkshopMaterialConfig.js';
import { parseWorkshopImageDimensions } from './ProceduralWorkshopImageMetadata.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const OUTPUT_SIZES = Object.freeze([512, 448, 384, 320, 256]);
const PBR_SOURCE_COUNT = 4;
const TARGET_DATA_URL_LENGTH = Math.min(
  MAX_WORKSHOP_MATERIAL_SOURCE_DATA_URL_LENGTH,
  Math.floor(MAX_WORKSHOP_MATERIAL_TOTAL_SOURCE_LENGTH / PBR_SOURCE_COUNT),
);
const ALBEDO_OUTPUT_TYPE = 'image/webp';
const ALBEDO_OUTPUT_QUALITY = 0.88;
const DATA_OUTPUT_TYPE = 'image/png';
const VALID_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const VALID_TEXTURE_KINDS = new Set(['albedo', 'normal', 'orm', 'height']);
const DATA_TEXTURE_KINDS = new Set(['normal', 'orm', 'height']);

function textureKindLabel(kind) {
  return kind === 'orm' ? 'ORM' : `${kind[0].toUpperCase()}${kind.slice(1)}`;
}

function loadImageElement(file, label) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({
      image,
      close() {
        URL.revokeObjectURL(url);
      },
    });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`The selected ${label} image could not be decoded.`));
    };
    image.src = url;
  });
}

async function decodeImage(file, kind, label) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        colorSpaceConversion: DATA_TEXTURE_KINDS.has(kind) ? 'none' : 'default',
        premultiplyAlpha: 'none',
      });
      return {
        image: bitmap,
        close() {
          bitmap.close();
        },
      };
    } catch {
      return loadImageElement(file, label);
    }
  }
  return loadImageElement(file, label);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function blobToDataUrl(blob, label) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`The processed ${label} image could not be read.`));
    reader.readAsDataURL(blob);
  });
}

function estimatedDataUrlLength(blob) {
  const prefixLength = `data:${blob.type || 'application/octet-stream'};base64,`.length;
  return prefixLength + 4 * Math.ceil(blob.size / 3);
}

function dimensionsMatchHeader(decodedWidth, decodedHeight, sourceDimensions) {
  return (
    decodedWidth === sourceDimensions.width
    && decodedHeight === sourceDimensions.height
  ) || (
    decodedWidth === sourceDimensions.height
    && decodedHeight === sourceDimensions.width
  );
}

function createCanvasContext(canvas, kind) {
  let context = null;
  if (!DATA_TEXTURE_KINDS.has(kind)) {
    try {
      context = canvas.getContext('2d', {
        alpha: false,
        colorSpace: 'srgb',
      });
    } catch {
      context = null;
    }
  }
  context ??= canvas.getContext('2d', { alpha: false });
  context ??= canvas.getContext('2d');
  return context;
}

function drawTexture(image, kind, label, crop, outputSize) {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = createCanvasContext(canvas, kind);
  if (!context) {
    throw new Error(`The browser could not prepare the ${label} texture.`);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    outputSize,
    outputSize,
  );
  return canvas;
}

async function encodeCanvas(canvas, kind) {
  if (DATA_TEXTURE_KINDS.has(kind)) {
    return canvasToBlob(canvas, DATA_OUTPUT_TYPE);
  }
  return await canvasToBlob(canvas, ALBEDO_OUTPUT_TYPE, ALBEDO_OUTPUT_QUALITY)
    ?? canvasToBlob(canvas, DATA_OUTPUT_TYPE);
}

async function encodeWithinBudget(image, kind, label, crop) {
  for (const outputSize of OUTPUT_SIZES) {
    const canvas = drawTexture(image, kind, label, crop, outputSize);
    const blob = await encodeCanvas(canvas, kind);
    if (!blob || estimatedDataUrlLength(blob) > TARGET_DATA_URL_LENGTH) continue;
    const dataUrl = await blobToDataUrl(blob, label);
    if (dataUrl.length <= TARGET_DATA_URL_LENGTH) {
      return { dataUrl, outputSize };
    }
  }
  throw new Error(
    `${label} texture could not fit the workshop material budget without reducing it below 256 px.`,
  );
}

export async function prepareWorkshopTexture(file, kind = 'albedo') {
  if (!VALID_TEXTURE_KINDS.has(kind)) {
    throw new Error(`Unsupported workshop texture kind: ${kind}.`);
  }
  const label = textureKindLabel(kind);
  if (typeof File === 'undefined' || !(file instanceof File)) {
    throw new Error(`Choose a ${label} image first.`);
  }
  if (!VALID_UPLOAD_TYPES.has(file.type)) {
    throw new Error(`Use a PNG, JPEG, or WebP image for ${label}.`);
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`The source ${label} image must be smaller than 8 MB.`);
  }

  const sourceDimensions = parseWorkshopImageDimensions(await file.arrayBuffer(), file.type);
  const decoded = await decodeImage(file, kind, label);
  try {
    const decodedWidth = decoded.image.naturalWidth ?? decoded.image.width;
    const decodedHeight = decoded.image.naturalHeight ?? decoded.image.height;
    if (!dimensionsMatchHeader(decodedWidth, decodedHeight, sourceDimensions)) {
      throw new Error(`The decoded ${label} dimensions do not match its image header.`);
    }

    const cropSize = Math.min(decodedWidth, decodedHeight);
    const crop = Object.freeze({
      x: (decodedWidth - cropSize) / 2,
      y: (decodedHeight - cropSize) / 2,
      size: cropSize,
    });
    const { dataUrl, outputSize } = await encodeWithinBudget(
      decoded.image,
      kind,
      label,
      crop,
    );

    return Object.freeze({
      name: file.name,
      dataUrl,
      width: outputSize,
      height: outputSize,
    });
  } finally {
    decoded.close();
  }
}

export function prepareWorkshopAlbedo(file) {
  return prepareWorkshopTexture(file, 'albedo');
}
