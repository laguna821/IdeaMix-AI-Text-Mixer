import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

const MODEL_FAST = 'gemini-2.5-flash';

// Helper to generate random ideas
export const generateIdeas = async (topic: string): Promise<string[]> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `Topic: ${topic}. 
      Generate 5 to 8 short, creative, and distinct text notes/ideas related to this topic.
      Keep each note under 15 words.
      Language: Korean.
      Return a JSON array of strings.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error generating ideas:", error);
    return ["아이디어 생성 실패. 다시 시도해주세요."];
  }
};

// Helper to transform selected notes (merge, split, summarize, etc.)
export const transformNotes = async (notes: string[], prompt: string): Promise<string[]> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `
      Context: The user has selected the following sticky notes:
      ${JSON.stringify(notes)}

      User Instruction: "${prompt}"

      Task: Perform the requested action on the notes (e.g., merge, summarize, split, translate, brainstorm related).
      Return the result as a JSON array of strings. Each string is the content of a new sticky note.
      
      Guidelines:
      - If merging, return 1 merged string.
      - If splitting, return multiple strings.
      - If modifying/translating, return the modified versions.
      - Language: Korean (unless specified otherwise).
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error transforming notes:", error);
    return ["작업을 수행할 수 없습니다."];
  }
};

// Helper to merge two notes (Drag & Drop legacy support)
export const mergeNotes = async (noteA: string, noteB: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `Merge these two ideas into a detailed, comprehensive paragraph that combines the insights of both.
      Idea 1: "${noteA}"
      Idea 2: "${noteB}"
      
      Requirements:
      - Do NOT summarize briefly. Expand on the ideas.
      - Create a rich, cohesive text that connects both concepts.
      - Language: Korean.
      - Return ONLY the plain text string of the new content.`,
    });

    return response.text?.trim() || `${noteA} + ${noteB}`;
  } catch (error) {
    console.error("Error merging notes:", error);
    return noteA; // Fallback
  }
};

// Helper to reformat text into an outline
export const formatToOutline = async (content: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `Reformat the following text into a clear, structured outline using bullet points (Markdown format).
      
      Source Text:
      "${content}"

      Requirements:
      - Use standard Markdown bullet points (- or *).
      - Group related points logically.
      - Make it easy to read and scan.
      - Language: Korean.
      - Return ONLY the formatted text.`,
    });

    return response.text?.trim() || content;
  } catch (error) {
    console.error("Error formatting to outline:", error);
    return content;
  }
};

// Helper to generate related notes based on context
export const generateRelatedNotes = async (context: string): Promise<string[]> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `Based on the following note content, generate 4-6 new, distinct, and creative ideas/notes that expand on this topic or offer related perspectives.
      
      Source Context:
      "${context}"

      Requirements:
      - Keep each new note under 20 words.
      - Language: Korean.
      - Return a JSON array of strings.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error generating related notes:", error);
    return [];
  }
};