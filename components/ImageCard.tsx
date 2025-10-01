
import React from 'react';
import { ProcessedImage, ImageProcessingStatus } from '../types';
import { Loader } from './Loader';
import { NO_TEXT_DETECTED_MARKER } from '../constants';

interface ImageCardProps {
  imageInfo: ProcessedImage;
  onRetry: (id: string) => void;
  onDownload: (id: string) => void;
  disabled: boolean;
}

interface InfoRowProps {
  label: string;
  value?: string | null; // Allow null for value
  valueClassName?: string;
  children?: React.ReactNode;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, valueClassName, children }) => (
  <div className="mb-2">
    <span className="text-xs text-slate-400 block">{label}</span>
    {value !== undefined && value !== null && <p className={`text-sm text-slate-200 break-words ${valueClassName || ''}`}>{value}</p>}
    {children}
  </div>
);


export const ImageCard: React.FC<ImageCardProps> = ({ imageInfo, onRetry, onDownload, disabled }) => {
  const { id, previewUrl, originalName, status, suggestedName, errorMessage, gameProvider, ocrText, width, height, imageType } = imageInfo;

  let statusColor = 'bg-slate-600';
  let statusText = 'Queued';

  switch (status) {
    case 'api_key_missing':
      statusColor = 'bg-red-700';
      statusText = 'API Key Missing';
      break;
    case 'mapping_parse_error':
      statusColor = 'bg-red-700';
      statusText = 'Mapping Error';
      break;
    case 'ocr_extracting':
      statusColor = 'bg-sky-500 animate-pulse';
      statusText = 'OCR Extracting...';
      break;
    case 'name_matching':
      statusColor = 'bg-sky-500 animate-pulse';
      statusText = 'Matching Name...';
      break;
    case 'processing': // Legacy or general processing
      statusColor = 'bg-sky-500 animate-pulse';
      statusText = 'Processing...';
      break;
    case 'completed':
      statusColor = 'bg-green-500';
      statusText = 'Completed';
      break;
    case 'error':
      statusColor = 'bg-red-500';
      statusText = 'Error';
      break;
  }

  const showOcrText = ocrText && ocrText !== 'OCR_FAILED' && ocrText !== NO_TEXT_DETECTED_MARKER;
  const canRetry = status === 'error' || status === 'api_key_missing' || status === 'mapping_parse_error';

  return (
    <div className={`bg-slate-700/70 rounded-lg shadow-lg overflow-hidden flex flex-col transition-all duration-300 hover:shadow-sky-500/30 ${disabled && !canRetry ? 'opacity-70 cursor-not-allowed' : ''}`}>
      <div className="relative aspect-video bg-slate-800">
        <img src={previewUrl} alt={originalName} className="w-full h-full object-contain" />
        <div className={`absolute top-2 right-2 px-2 py-1 text-xs text-white rounded ${statusColor} z-10`}>
          {statusText}
        </div>
      </div>
      
      <div className="p-4 flex-grow flex flex-col justify-between">
        <div>
          <InfoRow label="Original Name" value={originalName} valueClassName="truncate" />

          {width && height ? (
            <InfoRow 
              label="Dimensions" 
              value={`${width}x${height}${imageType && imageType !== 'standard' ? ` (${imageType})` : ''}`}
              valueClassName="text-xs text-slate-400 capitalize"
            />
          ) : null}

          {(status === 'ocr_extracting' || status === 'name_matching' || status === 'processing') && (
            <div className="flex items-center justify-center my-4 text-sky-300">
              <Loader /> <span className="ml-2 text-sm">{statusText}</span>
            </div>
          )}

          {showOcrText && (
             <InfoRow label="OCR Text" value={ocrText} valueClassName="text-slate-300 max-h-16 overflow-y-auto text-xs" />
          )}
          {ocrText === NO_TEXT_DETECTED_MARKER && (
             <InfoRow label="OCR Text" value="No significant text detected" valueClassName="text-slate-400 text-xs italic" />
          )}


          {status === 'completed' && (
            <>
              <InfoRow label="New Name" value={suggestedName} valueClassName="font-semibold text-sky-300" />
              {gameProvider && <InfoRow label="Provider" value={gameProvider} valueClassName="text-slate-300" />}
            </>
          )}

          {errorMessage && (status === 'error' || status === 'api_key_missing' || status === 'mapping_parse_error') && (
            <InfoRow label="Error" valueClassName="text-red-300">
              <p className="text-sm break-words">{errorMessage}</p>
            </InfoRow>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-600 flex space-x-2">
          {status === 'completed' && suggestedName && (
            <button
              onClick={() => onDownload(id)}
              className="flex-1 px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm rounded-md transition-colors duration-150 shadow-sm flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={disabled}
              aria-label={`Download ${suggestedName}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
          )}
          {canRetry && (
            <button
              onClick={() => onRetry(id)}
              className="flex-1 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm rounded-md transition-colors duration-150 shadow-sm flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={disabled}
              aria-label={`Retry processing for ${originalName}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Retry
            </button>
          )}
           {/* Placeholder for layout consistency if no buttons */}
           {!(status === 'completed' && suggestedName) && !canRetry && (
             <div className="flex-1 h-9"></div> 
           )}
        </div>
      </div>
    </div>
  );
};