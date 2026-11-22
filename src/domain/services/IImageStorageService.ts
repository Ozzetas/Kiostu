export interface StoredImageResult {
  readonly fileName: string;
  readonly resolvedUri: string;
}

export interface IImageStorageService {
  pickFromCamera(): Promise<StoredImageResult | null>;
  pickFromGallery(): Promise<StoredImageResult | null>;
  importFromUrl(rawUrl: string): Promise<StoredImageResult>;
  resolveImageUri(fileName: string | null): string | null;
  deleteImage(fileName: string): Promise<void>;
  pruneOrphanImages(referencedFileNames: ReadonlySet<string>): Promise<number>;
}