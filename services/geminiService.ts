import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { GEMINI_MODEL_TEXT } from '../constants';

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove "data:image/webp;base64," prefix
      resolve(result.substring(result.indexOf(',') + 1));
    };
    reader.onerror = (error) => reject(error);
  });
};

export const extractTextFromImageUsingGemini = async (
  apiKey: string,
  base64ImageData: string,
  mimeType: string = 'image/webp'
): Promise<string | null> => {
  if (!apiKey) {
    console.error("Gemini API key is not set.");
    throw new Error("API Key for Gemini is missing.");
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const imagePart = {
      inlineData: {
        mimeType: mimeType,
        data: base64ImageData,
      },
    };
    const textPart = {
      text: "Extract all text visible in this image. If no text is clearly visible, respond with 'NO_TEXT_DETECTED'. Focus on game titles or prominent text.",
    };

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_TEXT, 
      contents: { parts: [imagePart, textPart] },
      config: { thinkingConfig: { thinkingBudget: 0 } } // Low latency for faster OCR
    });

    const text = response.text;
    if (text && text.trim() !== "" && !text.includes("NO_TEXT_DETECTED")) {
      return text.trim();
    }
    return null; // No text detected or only marker found
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error && error.message.includes("API key not valid")) {
        throw new Error("Invalid API Key for Gemini. Please check the provided key.");
    }
    throw new Error("Failed to extract text using Gemini API.");
  }
};