
export interface FilenameMappingEntry {
  gameName: string;         // Name of the game from the user's table
  imsGameCode: string;      // IMS Game Code from the user's table
  provider?: string;        // Game Provider from the user's table (for folder organization)
}

export type ImageProcessingStatus =
  | 'queued'
  | 'processing'
  | 'ocr_extracting'
  | 'name_matching'
  | 'completed'
  | 'error'
  | 'api_key_missing'
  | 'mapping_parse_error';

export interface ProcessedImage {
  id: string;
  file: File;
  originalName: string;
  previewUrl: string;
  status: ImageProcessingStatus;
  ocrText?: string;             // Text extracted from the image
  suggestedName?: string;
  errorMessage?: string;
  gameProvider?: string;      // Game provider determined from mapping for ZIP folder
  imageType?: 'portrait' | 'landscape' | 'standard';
  width?: number;
  height?: number;
}