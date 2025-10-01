import React, { useState, useEffect, useCallback } from 'react';
import { ProcessedImage, ImageProcessingStatus, FilenameMappingEntry } from './types';
import { FileUpload } from './components/FileUpload';
import { ImageCard } from './components/ImageCard';
import { Loader } from './components/Loader';
import JSZip from 'jszip';
import { extractTextFromImageUsingGemini, fileToBase64 } from './services/geminiService';
import { MAPPING_COL_GAME_NAME, MAPPING_COL_IMS_CODE, MAPPING_COL_PROVIDER, NO_TEXT_DETECTED_MARKER } from './constants';

// Helper to normalize text for matching
const normalizeText = (text?: string): string => {
  if (!text) return "";
  // Aggressively remove all non-alphanumeric characters (including spaces) for better matching.
  return text.toLowerCase().replace(/[^a-z0-9]/gi, '');
};

const getImageMetadata = (file: File): Promise<{ width: number, height: number, imageType: 'portrait' | 'landscape' | 'standard' }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const { width, height } = img;
      let imageType: 'portrait' | 'landscape' | 'standard' = 'standard';
      if (width === 500 && height === 693) {
        imageType = 'portrait';
      } else if (width === 500 && height === 333) {
        imageType = 'landscape';
      }
      resolve({ width, height, imageType });
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = (err) => {
        reject(err);
        URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  });
};


const App: React.FC = () => {
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>([]);
  const [isCurrentlyProcessingImage, setIsCurrentlyProcessingImage] = useState<boolean>(false);
  const [startProcessingFlag, setStartProcessingFlag] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');

  const [pastedCustomMappings, setPastedCustomMappings] = useState<string>('');
  const [manualFilenameMappings, setManualFilenameMappings] = useState<FilenameMappingEntry[]>([]);
  const [mappingParseMessage, setMappingParseMessage] = useState<string | null>(null); // For feedback on textarea content
  const [unusedMappingsMessage, setUnusedMappingsMessage] = useState<string | null>(null); // For feedback on mappings vs uploaded files
  const [startAttemptErrorMessage, setStartAttemptErrorMessage] = useState<string | null>(null); // For errors when "Start All" is clicked


  useEffect(() => {
    // API Key Initialization from environment variable
    const keyFromEnv = process.env.API_KEY;
    if (keyFromEnv) {
      setApiKey(keyFromEnv);
      setApiKeyInput(keyFromEnv);
    }
  }, []);

  const sanitizeFilename = (name: string, fallbackName: string = 'renamed_image', maxLength: number = 50): string => {
    let saneName = name.replace(/\.webp$/i, '');
    saneName = saneName.replace(/[^\w.-]/gi, '_');
    saneName = saneName.replace(/\s+/g, '_');
    if (saneName.length > maxLength) {
      saneName = saneName.substring(0, maxLength);
    }
    saneName = saneName.replace(/[_.-]+$/, '').replace(/^[_.-]+/, '');
    return saneName || fallbackName;
  };

  const parseCustomMappings = useCallback((mappingsString: string): FilenameMappingEntry[] => {
    if (!mappingsString.trim()) {
      setMappingParseMessage("Mapping data is empty. Paste your tab-separated table.");
      return [];
    }
    const lines = mappingsString.trim().split('\n');
    if (lines.length === 0) {
      setMappingParseMessage("No lines found in mapping data.");
      return [];
    }

    const headerLine = lines[0].toLowerCase().split('\t').map(h => h.trim());
    const gameNameIndex = headerLine.indexOf(MAPPING_COL_GAME_NAME.toLowerCase());
    const imsCodeIndex = headerLine.indexOf(MAPPING_COL_IMS_CODE.toLowerCase());
    const providerIndex = headerLine.indexOf(MAPPING_COL_PROVIDER.toLowerCase());

    if (gameNameIndex === -1 || imsCodeIndex === -1) {
      setMappingParseMessage(`Error: Required columns missing. Ensure '${MAPPING_COL_GAME_NAME}' and '${MAPPING_COL_IMS_CODE}' headers are present. Data should be tab-separated.`);
      return [];
    }

    const newMappings: FilenameMappingEntry[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split('\t').map(cell => cell.trim());
      // Ensure cells exist for required columns before trying to access them
      if (cells.length > Math.max(gameNameIndex, imsCodeIndex)) {
        const gameName = cells[gameNameIndex];
        const imsGameCode = cells[imsCodeIndex];
        const provider = providerIndex !== -1 && cells.length > providerIndex ? cells[providerIndex] : undefined;

        if (gameName && imsGameCode) {
          newMappings.push({ gameName, imsGameCode, provider: provider || undefined });
        }
      }
    }
    
    if (newMappings.length === 0 && lines.length > 1) {
         setMappingParseMessage("Mappings parsed, but no valid entries found after the header row. Check data values and ensure they are tab-separated under the correct headers.");
    } else if (newMappings.length > 0) {
        setMappingParseMessage(`Successfully parsed ${newMappings.length} mapping entries.`);
    } else { // This implies lines.length <=1 (only header or empty) or headers not found and newMappings is 0
        setMappingParseMessage("No mapping entries found. Ensure data is present after the header row or check header names.");
    }
    return newMappings;
  }, []);


  const findMatchingGame = (
    ocrText: string | null,
    originalFilename: string,
    mappings: FilenameMappingEntry[]
  ): FilenameMappingEntry | null => {
    // Clean the filename to remove common prefixes (like dimensions) and the extension.
    const filenameGamePart = (originalFilename.substring(0, originalFilename.lastIndexOf('.')) || originalFilename)
                               .replace(/^[0-9]+x[0-9]+-/, ''); // e.g., "540x540-"
    
    const normalizedOcr = normalizeText(ocrText ?? "");
    const normalizedFilename = normalizeText(filenameGamePart);
  
    let bestMatch: FilenameMappingEntry | null = null;
    let highestScore = 0;

    for (const mapping of mappings) {
      const normalizedMappingGameName = normalizeText(mapping.gameName);
      if (!normalizedMappingGameName) continue;

      let currentScore = 0;
      
      // A flexible matching logic is needed. Sometimes the mapping name has extra info (e.g., "V94"),
      // and sometimes the OCR/filename has extra words (e.g., "Deluxe").
      // We check for inclusion in both directions and score based on match quality.

      // Priority 1: OCR Text Match
      if (normalizedOcr) {
        if (normalizedMappingGameName.includes(normalizedOcr)) {
          // Case: Mapping="GameV2", OCR="Game" -> Good match
          currentScore = Math.max(currentScore, 20 + normalizedOcr.length);
        }
        if (normalizedOcr.includes(normalizedMappingGameName)) {
          // Case: Mapping="Game", OCR="Game Deluxe" -> Good match
          currentScore = Math.max(currentScore, 20 + normalizedMappingGameName.length);
        }
      }

      // Priority 2: Filename Match
      if (normalizedFilename) {
        if (normalizedMappingGameName.includes(normalizedFilename)) {
          // Case: Mapping="GameV2", Filename="game" -> Decent match
          currentScore = Math.max(currentScore, 10 + normalizedFilename.length);
        }
        if (normalizedFilename.includes(normalizedMappingGameName)) {
          // Case: Mapping="Game", Filename="game-official" -> Decent match
          currentScore = Math.max(currentScore, 10 + normalizedMappingGameName.length);
        }
      }
      
      if (currentScore > highestScore) {
        highestScore = currentScore;
        bestMatch = mapping;
      }
    }
    return bestMatch;
  };

  const processSingleImage = useCallback(async (imageToProcess: ProcessedImage, currentMappings: FilenameMappingEntry[]): Promise<void> => {
    if (!apiKey) {
      setProcessedImages(prev => prev.map(img => img.id === imageToProcess.id ? { ...img, status: 'api_key_missing', errorMessage: "API Key is missing. OCR skipped." } : img));
      return;
    }
     if (currentMappings.length === 0) {
      setProcessedImages(prev => prev.map(img => img.id === imageToProcess.id ? { ...img, status: 'mapping_parse_error', errorMessage: "No valid mappings loaded. Cannot process." } : img));
      return;
    }

    setProcessedImages(prev => prev.map(img => img.id === imageToProcess.id ? { ...img, status: 'ocr_extracting' } : img));
    
    let ocrText: string | null = null;
    try {
      const base64Data = await fileToBase64(imageToProcess.file);
      ocrText = await extractTextFromImageUsingGemini(apiKey, base64Data, imageToProcess.file.type);
      setProcessedImages(prev => prev.map(img => img.id === imageToProcess.id ? { ...img, ocrText: ocrText || NO_TEXT_DETECTED_MARKER, status: 'name_matching' } : img));
    } catch (error: any) {
      console.error("Error during OCR extraction:", error);
      setProcessedImages(prev => prev.map(img => img.id === imageToProcess.id ? {
        ...img,
        status: 'error',
        errorMessage: error.message || 'Failed OCR extraction.',
        ocrText: 'OCR_FAILED'
      } : img));
      return; 
    }

    try {
      const matchedMapping = findMatchingGame(ocrText, imageToProcess.originalName, currentMappings);

      if (matchedMapping) {
        const suggestedName = `${sanitizeFilename(matchedMapping.imsGameCode, matchedMapping.imsGameCode)}.webp`;
        setProcessedImages(prev => prev.map(img => img.id === imageToProcess.id ? {
          ...img,
          status: 'completed',
          suggestedName: suggestedName,
          gameProvider: matchedMapping.provider,
          errorMessage: undefined,
        } : img));
      } else {
        setProcessedImages(prev => prev.map(img => img.id === imageToProcess.id ? {
          ...img,
          status: 'error',
          errorMessage: 'Game not found in mappings.',
        } : img));
      }
    } catch (error: any) {
      console.error("Error during name matching/processing image:", error);
      setProcessedImages(prev => prev.map(img => img.id === imageToProcess.id ? {
        ...img,
        status: 'error',
        errorMessage: error.message || 'Failed to process and match name.',
      } : img));
    }
  }, [apiKey, findMatchingGame, sanitizeFilename]); 

  // Main processing loop effect
  useEffect(() => {
    if (isCurrentlyProcessingImage || !startProcessingFlag || isZipping) return;

    const nextImageToProcess = processedImages.find(img => img.status === 'queued');
    if (nextImageToProcess) {
      setIsCurrentlyProcessingImage(true);
      processSingleImage(nextImageToProcess, manualFilenameMappings).finally(() => {
        setIsCurrentlyProcessingImage(false);
      });
    } else if (startProcessingFlag && processedImages.length > 0) {
      // No more items in the queue, stop the processing loop.
      setStartProcessingFlag(false);
    }
  }, [processedImages, isCurrentlyProcessingImage, processSingleImage, startProcessingFlag, manualFilenameMappings, isZipping]);


  const handleFilesSelected = async (files: File[]) => {
    setStartAttemptErrorMessage(null); // Clear errors when new files are added
    setUnusedMappingsMessage(null); // Clear unused mappings message

    const newImagesPromises = files.map(async (file, index) => {
      const previewUrl = URL.createObjectURL(file);
      try {
        const { width, height, imageType } = await getImageMetadata(file);
        return {
          id: `${Date.now()}-${index}-${file.name}`,
          file,
          originalName: file.name,
          previewUrl,
          status: apiKey ? 'queued' : 'api_key_missing',
          errorMessage: apiKey ? undefined : "API Key is missing.",
          width,
          height,
          imageType,
        };
      } catch (error) {
        console.error(`Failed to read metadata for ${file.name}:`, error);
        return {
          id: `${Date.now()}-${index}-${file.name}`,
          file,
          originalName: file.name,
          previewUrl,
          status: 'error',
          errorMessage: 'Could not read image dimensions.',
          width: undefined,
          height: undefined,
          imageType: 'standard',
        };
      }
    });

    const newImages = (await Promise.all(newImagesPromises)) as ProcessedImage[];
    setProcessedImages(prev => [...prev, ...newImages]);
  };

  const handleStartAllProcessing = () => {
    setStartAttemptErrorMessage(null); // Clear previous attempt errors
    setUnusedMappingsMessage(null); // Clear previous unused mappings message
    
    const currentParsedMappings = parseCustomMappings(pastedCustomMappings); // This sets/updates mappingParseMessage
    setManualFilenameMappings(currentParsedMappings);

    // Check for unused mappings based on filenames (pre-OCR check)
    if (currentParsedMappings.length > 0 && processedImages.length > 0) {
      const allImageOriginalNamesNormalized = processedImages.map(img => normalizeText(img.originalName.substring(0, img.originalName.lastIndexOf('.')) || img.originalName));
      const trulyUnusedMappingNames: string[] = [];

      currentParsedMappings.forEach(mapping => {
        const normalizedMappingGameName = normalizeText(mapping.gameName);
        if (!normalizedMappingGameName) return; // Skip if mapping game name is empty

        // Check if the mapping game name is a substring of any normalized original filename
        const isPotentiallyUsed = allImageOriginalNamesNormalized.some(imgName => 
          imgName.includes(normalizedMappingGameName)
        );

        if (!isPotentiallyUsed) {
          trulyUnusedMappingNames.push(mapping.gameName);
        }
      });

      if (trulyUnusedMappingNames.length > 0) {
        const limit = 3; // Show first few
        const namesToShow = trulyUnusedMappingNames.slice(0, limit).join('", "');
        const moreCount = trulyUnusedMappingNames.length - limit;
        const moreText = moreCount > 0 ? ` (and ${moreCount} more)` : '';
        setUnusedMappingsMessage(`Note: No uploaded images seem to directly relate to mapping entries for: "${namesToShow}"${moreText}. These mappings might not be used if OCR also doesn't find a match.`);
      }
    }


    if (!apiKey) {
      setStartAttemptErrorMessage("Cannot start processing: API Key is missing. OCR functionality requires it.");
      return;
    }
    
    if (pastedCustomMappings.trim() === "") {
        setStartAttemptErrorMessage("Cannot start processing: Mapping data is empty. Please paste your game mappings.");
        return;
    }

    if (currentParsedMappings.length === 0) {
        // mappingParseMessage should provide detailed error from parseCustomMappings
        const baseMessage = "Cannot start processing: No valid mapping entries found. ";
        const specificError = (mappingParseMessage && mappingParseMessage.toLowerCase().startsWith("error:")) ? 
                              mappingParseMessage : 
                              "Please check mapping data format, ensure headers ('Name', 'IMS Game Code') are correct and data exists under them.";
        setStartAttemptErrorMessage(baseMessage + specificError);
        return;
    }

    const imagesToProcess = processedImages.filter(img => 
        ['queued', 'error', 'api_key_missing', 'mapping_parse_error'].includes(img.status)
    );

    if (imagesToProcess.length === 0) {
      setStartAttemptErrorMessage(processedImages.length === 0 ? 
          "Cannot start processing: No images have been uploaded." : 
          "Cannot start processing: No images are currently pending or in an error state to reprocess."
      );
      return;
    }
    
    // All checks passed, proceed
    setProcessedImages(prev => prev.map(img =>
      (imagesToProcess.some(procImg => procImg.id === img.id))
        ? { ...img, status: 'queued', errorMessage: undefined, gameProvider: undefined, suggestedName: undefined, ocrText: undefined }
        : img
    ));
    setStartProcessingFlag(true);
  };
  
  const handleRetry = (id: string) => {
    setProcessedImages(prev => prev.map(img => img.id === id ? { ...img, status: 'queued', errorMessage: undefined, gameProvider: undefined, suggestedName: undefined, ocrText: undefined } : img));
    if (!startProcessingFlag && !isCurrentlyProcessingImage) {
        setStartProcessingFlag(true); 
    }
  };

  const handleDownload = (id: string) => {
    const imageInfo = processedImages.find(img => img.id === id);
    if (imageInfo && imageInfo.file && imageInfo.suggestedName) {
      const link = document.createElement('a');
      link.href = imageInfo.previewUrl;
      link.download = imageInfo.suggestedName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };
  
  const handleClearAll = () => {
    processedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setProcessedImages([]);
    setStartProcessingFlag(false);
    setIsCurrentlyProcessingImage(false);
    setIsZipping(false);
    setMappingParseMessage(null);
    setUnusedMappingsMessage(null);
    setStartAttemptErrorMessage(null);
  };

  const createAndDownloadZip = useCallback(async () => {
    setIsZipping(true);
    setStartAttemptErrorMessage(null); // Clear any previous error messages
    const zip = new JSZip();
    const completedImages = processedImages.filter(img => img.status === 'completed' && img.suggestedName);

    if (completedImages.length === 0) {
      setStartAttemptErrorMessage("Download failed: No successfully processed images are available to include in the ZIP.");
      setIsZipping(false);
      return;
    }

    completedImages.forEach(imageInfo => {
      if (imageInfo.file && imageInfo.suggestedName) {
        let filePathInZip = imageInfo.suggestedName;
        if (imageInfo.gameProvider && imageInfo.gameProvider.trim() !== "") {
          const sanitizedProvider = sanitizeFilename(imageInfo.gameProvider, 'default_provider');
          
          let subfolder = '';
          if (imageInfo.imageType === 'portrait') {
            subfolder = 'portrait/';
          } else if (imageInfo.imageType === 'landscape') {
            subfolder = 'landscape/';
          }
          
          filePathInZip = `${sanitizedProvider}/${subfolder}${imageInfo.suggestedName}`;
        }
        zip.file(filePathInZip, imageInfo.file);
      }
    });

    try {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `renamed_images_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error("Error creating ZIP file:", error);
      setStartAttemptErrorMessage("An unexpected error occurred while creating the ZIP file.");
    } finally {
      setIsZipping(false);
    }
  }, [processedImages, sanitizeFilename]);

  const handleDownloadZip = () => {
    createAndDownloadZip();
  }
                           
  const canStartProcessing = (apiKey != null) && 
                           (processedImages.some(img => ['queued', 'error', 'api_key_missing', 'mapping_parse_error'].includes(img.status))) && 
                           !isCurrentlyProcessingImage && !startProcessingFlag && !isZipping &&
                           (pastedCustomMappings.trim() !== ""); 
                           
  const globalDisable = isCurrentlyProcessingImage || startProcessingFlag || isZipping || !apiKey;
  const processingQueueCount = processedImages.filter(img => ['queued', 'ocr_extracting', 'name_matching', 'processing'].includes(img.status)).length;
  const completedImagesCount = processedImages.filter(img => img.status === 'completed').length;
  const canDownloadZip = completedImagesCount > 0 && !isZipping && !startProcessingFlag && !isCurrentlyProcessingImage;


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-700 text-slate-100 p-4 sm:p-8 flex flex-col items-center">
      <header className="w-full max-w-4xl mb-8 text-center">
        <img src="https://digibeat.com/wp-content/uploads/2022/06/logo-white-300x80.png" alt="Digibeat Logo" className="mx-auto mb-4 h-12" />
        <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">
          WebP - Game code renamer
        </h1>
        <p className="mt-2 text-slate-300 text-sm sm:text-base">
          Rename .webp images using OCR and filename analysis against your custom game mappings. Output to an organized ZIP.
        </p>
      </header>

      {/* API Key Input Section */}
      <div className="w-full max-w-4xl p-6 mb-6 bg-slate-800/70 shadow-lg rounded-xl backdrop-blur-md border border-slate-700">
        <h2 className="text-lg font-semibold text-slate-200 mb-2 flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-sky-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
          </svg>
          API Key Configuration
        </h2>
        <p className="text-xs text-slate-400 mb-3">
          A Google Gemini API key is required for OCR. You can get one from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Google AI Studio</a>.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setApiKey(apiKeyInput.trim()); } }}
            placeholder="Enter your Gemini API Key here..."
            className="flex-grow p-2 bg-slate-900/70 border border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors text-slate-300 text-sm placeholder-slate-500"
            aria-label="Gemini API Key input"
          />
          <button
            onClick={() => {
              const trimmedKey = apiKeyInput.trim();
              setApiKey(trimmedKey);
              if (trimmedKey) {
                setProcessedImages(prev => prev.map(img => img.status === 'api_key_missing' ? { ...img, status: 'queued', errorMessage: undefined } : img));
              }
            }}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-md transition-all duration-200 ease-in-out disabled:bg-slate-600"
            disabled={!apiKeyInput.trim()}
          >
            Set Key
          </button>
        </div>
        {apiKey ? (
          <p className="mt-2 text-sm text-green-400">
            API Key is set. Ready for processing.
          </p>
        ) : (
          <p className="mt-2 text-sm text-red-400">
            API Key is not set. Please enter your key to enable OCR functionality.
          </p>
        )}
      </div>

      <main className="w-full max-w-4xl bg-slate-800/70 shadow-2xl rounded-xl p-6 sm:p-8 backdrop-blur-md border border-slate-700">
        <FileUpload onFilesSelected={handleFilesSelected} disabled={globalDisable || !apiKey} />
        
        <div className="my-6 p-4 bg-slate-700/50 rounded-lg">
          <h3 className="text-lg font-semibold text-slate-200 mb-2">Custom Game Mappings (Tab-Separated)</h3>
          <p className="text-xs text-slate-400 mb-1">Paste table data (e.g., from a spreadsheet). Must include headers: "{MAPPING_COL_GAME_NAME}", "{MAPPING_COL_IMS_CODE}". Optional: "{MAPPING_COL_PROVIDER}". Other columns will be ignored.</p>
          <p className="text-xs text-slate-400 mb-2">Example (ensure values are separated by tabs, not spaces):</p>
          <pre className="text-xs text-slate-400 bg-slate-900 p-2 rounded mb-2 overflow-x-auto">
            {`${MAPPING_COL_GAME_NAME}\t${MAPPING_COL_PROVIDER}\tSome Other Column\t${MAPPING_COL_IMS_CODE}\tYet Another Column\nKing's Mystery\tPlaytech\tData To Ignore\tggas_kmsterya1_pop\tMore Ignored Data\nThree Fold the Gold\tGames Global\t2025-01-01\t123456vds_mcg\tActive`}
          </pre>
          <textarea
            className="w-full h-32 p-2 bg-slate-900/70 border border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors text-slate-300 text-sm disabled:opacity-50"
            placeholder="Paste your tab-separated data here..."
            value={pastedCustomMappings}
            onChange={(e) => setPastedCustomMappings(e.target.value)}
            disabled={globalDisable}
            aria-label="Custom game mappings input"
          />
          {mappingParseMessage && (
            <p className={`mt-2 text-xs ${mappingParseMessage.toLowerCase().startsWith('error:') ? 'text-red-400' : 'text-green-400'}`}>
              {mappingParseMessage}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4 items-center justify-between mt-6 border-t border-slate-700 pt-6">
          <div className="flex gap-4">
            <button
              onClick={handleStartAllProcessing}
              disabled={!canStartProcessing}
              className="px-6 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-md transition-all duration-200 ease-in-out disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed disabled:shadow-none transform hover:scale-105 disabled:scale-100 flex items-center"
              aria-label="Start processing all queued images"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z" clipRule="evenodd" />
              </svg>
              Start Processing All
            </button>
            <button
              onClick={handleClearAll}
              disabled={processedImages.length === 0 || isCurrentlyProcessingImage || startProcessingFlag || isZipping}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-slate-200 font-bold rounded-lg shadow-md transition-all duration-200 ease-in-out disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed disabled:shadow-none"
              aria-label="Clear all uploaded images and data"
            >
              Clear All
            </button>
          </div>
          <button
            onClick={handleDownloadZip}
            disabled={!canDownloadZip}
            className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg shadow-md transition-all duration-200 ease-in-out disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed disabled:shadow-none transform hover:scale-105 disabled:scale-100 flex items-center"
            aria-label="Download all completed images as a ZIP"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download ZIP ({completedImagesCount})
          </button>
        </div>
        
        {startAttemptErrorMessage && (
            <div className="mt-4 p-3 bg-red-500/30 border border-red-700 text-red-200 rounded-md text-center text-sm">
                <p>{startAttemptErrorMessage}</p>
            </div>
        )}
        {unusedMappingsMessage && !startAttemptErrorMessage && ( // Don't show if there's a more critical error
            <div className="mt-4 p-3 bg-amber-500/20 border border-amber-700 text-amber-200 rounded-md text-sm">
                <p>{unusedMappingsMessage}</p>
            </div>
        )}


        {processingQueueCount > 0 && (
          <div className="mt-6 text-center text-sky-300">
             <p>{processingQueueCount} image(s) in processing queue...</p>
          </div>
        )}
      </main>

      {processedImages.length > 0 && (
        <section className="w-full max-w-4xl mt-8">
          <h2 className="text-2xl font-semibold mb-4 text-slate-200">Processing Results</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {processedImages.map(imageInfo => (
              <ImageCard 
                key={imageInfo.id} 
                imageInfo={imageInfo} 
                onRetry={handleRetry} 
                onDownload={handleDownload}
                disabled={isCurrentlyProcessingImage || startProcessingFlag || isZipping}
              />
            ))}
          </div>
        </section>
      )}

      <footer className="w-full max-w-4xl mt-auto pt-8 pb-4 text-center text-slate-500 text-sm">
        <p>© 2025 Created by Bob Fox. Built with React & Tailwind CSS.</p>
      </footer>
    </div>
  );
};

export default App;