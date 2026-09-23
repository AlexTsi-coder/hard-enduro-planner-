
import { GoogleGenAI, Type } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("Gemini API key is not configured.");
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

/**
 * Service to analyze enduro route terrain using Gemini.
 * It provides insights on difficulty, terrain types, and potential obstacles.
 */
export const analyzeRouteTerrain = async (points: { lat: number, lng: number, elevation?: number }[]) => {
  if (!points || points.length < 2) return null;

  try {
    const ai = getAiClient();
    if (!ai) return null;
    // We send a subset of points to maintain efficiency and stay within token limits
    const samplingRate = Math.max(1, Math.floor(points.length / 50));
    const simplifiedPoints = points.filter((_, index) => index % samplingRate === 0);

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analyze this motorcycle route terrain and difficulty based on these points: ${JSON.stringify(simplifiedPoints)}`,
      config: {
        systemInstruction: "You are an expert enduro motorcycle route planner. Provide a professional analysis of the terrain, technical difficulty, and safety considerations.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            difficulty: {
              type: Type.STRING,
              description: "Overall difficulty level (e.g., Easy, Moderate, Hard, Expert)"
            },
            terrainSummary: {
              type: Type.STRING,
              description: "Brief description of terrain types (mud, rocky, loose gravel, etc.)"
            },
            technicalAdvice: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Technical advice for the rider"
            }
          },
          required: ["difficulty", "terrainSummary", "technicalAdvice"]
        }
      }
    });

    if (!response.text) return null;
    return JSON.parse(response.text.trim());
  } catch (error) {
    console.error("Error analyzing route terrain:", error);
    return null;
  }
};
