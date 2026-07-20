/// <reference types="vite/client" />

type DetectedBarcode = {
  rawValue: string;
};

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
