import React, { useCallback, useState } from 'react';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  disabled: boolean; // General disable flag (processing active, API key missing etc.)
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      // Fix for "Property 'type' does not exist on type 'unknown'". Cast to File.
      const webpFiles = Array.from(event.target.files).filter(file => (file as File).type === 'image/webp');
      if (webpFiles.length > 0) {
        onFilesSelected(webpFiles);
      } else if (event.target.files.length > 0) {
        alert("Please select .webp files only.");
      }
    }
    if (event.target) {
        event.target.value = ''; // Reset input to allow re-uploading the same file
    }
  }, [onFilesSelected]);

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    // Check if the leave target is outside the drop zone to prevent flickering
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
        return;
    }
    setIsDragging(false);
  }, [disabled]);
  
  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
  }, [disabled]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      // Fix for "Property 'type' does not exist on type 'unknown'". Cast to File.
      const webpFiles = Array.from(event.dataTransfer.files).filter(file => (file as File).type === 'image/webp');
       if (webpFiles.length > 0) {
        onFilesSelected(webpFiles);
      } else if (event.dataTransfer.files.length > 0) {
        alert("Please drop .webp files only.");
      }
      event.dataTransfer.clearData();
    }
  }, [onFilesSelected, disabled]);


  return (
    <div className="mb-6">
      <label
        htmlFor="file-upload"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
          flex flex-col items-center justify-center w-full h-48 px-4 
          border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-200 ease-in-out
          group
          ${disabled ? 'bg-slate-700/30 border-slate-600/50 cursor-not-allowed' : 
                     isDragging ? 'bg-sky-700/30 border-sky-500' : 'bg-slate-700/80 hover:bg-slate-600/80 border-slate-500 hover:border-sky-400'}
        `}
        aria-disabled={disabled}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-12 h-12 mb-3 ${disabled ? 'text-slate-500' : 'text-slate-400 group-hover:text-sky-300 transition-colors'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p className={`mb-1 text-sm ${disabled ? 'text-slate-500' : 'text-slate-300'}`}>
          <span className="font-semibold">Click to upload</span> or drag and drop
        </p>
        <p className={`text-xs ${disabled ? 'text-slate-600' : 'text-slate-400'}`}>
          .WEBP files only
        </p>
         <p className={`mt-1 text-xs ${disabled ? 'text-slate-600' : 'text-slate-500'}`}>
          (Processing starts after you provide mappings and click "Start Processing All")
        </p>
        <input
          id="file-upload"
          type="file"
          className="hidden"
          accept="image/webp"
          multiple
          onChange={handleFileChange}
          disabled={disabled}
        />
      </label>
      {disabled && (
        <p className="text-xs text-amber-400 mt-2 text-center">File upload is disabled. Ensure an API key is set and no processing is active.</p>
      )}
    </div>
  );
};
