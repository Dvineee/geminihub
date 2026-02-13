import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";
import { Bot } from "../types.ts";

const getApiKey = () => {
  try {
    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      return process.env.API_KEY;
    }
    if (typeof window !== 'undefined' && (window as any).process?.env?.API_KEY) {
      return (window as any).process.env.API_KEY;
    }
  } catch (e) {
    console.warn("API key retrieval failed", e);
  }
  return '';
};

export const getGeminiClient = () => {
  const apiKey = getApiKey();
  return new GoogleGenAI({ apiKey: apiKey || '' });
};

export const createBotChat = (bot: Bot, history: any[] = [], modelName: string = 'gemini-3-flash-preview'): Chat => {
  const ai = getGeminiClient();
  
  const fullSystemInstruction = `Senin adın ${bot.name}. Sen Premium Engineering modunda çalışan bir yapay zekasın.
    
    UZMANLIK: Yazılım Mimarisi, Clean Code ve SOLID.
    İLETİŞİM: ${bot.contactEmail || 'Belirtilmedi'} | ${bot.website || 'Belirtilmedi'}.
    
    KRİTİK: ${bot.systemInstruction || 'Professional and technical tone.'}
    
    KNOWLEDGE: ${bot.knowledgeBase.map(k => k.content).join('\n')}
    
    MEDYA: ${bot.hasImageGen ? '[GENERATE_IMAGE: prompt] formatını kullan.' : ''}`;

  const tools: any[] = [];
  if (bot.hasSearchGrounding) {
    tools.push({ googleSearch: {} });
  }

  return ai.chats.create({
    model: modelName,
    history: history,
    config: {
      systemInstruction: fullSystemInstruction,
      temperature: bot.temperature || 0.7,
      topP: bot.topP || 0.95,
      topK: bot.topK || 40,
      tools: tools.length > 0 ? tools : undefined
    },
  });
};

export const sendMessageWithGrounding = async (
  chat: Chat, 
  message: any, 
  onChunk: (text: string, grounding?: any[]) => void
) => {
  try {
    const streamResponse = await chat.sendMessageStream({ message });
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text;
      const grounding = c.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (text) {
        onChunk(text, grounding);
      }
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error?.message?.includes('429')) {
      throw new Error("SYSTEM_BUSY");
    }
    throw error;
  }
};

export const generateImage = async (prompt: string): Promise<string> => {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts: [{ text: prompt }] },
    config: { 
      imageConfig: { aspectRatio: "1:1" } 
    }
  });
  
  const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
  if (part?.inlineData) {
    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
  }
  throw new Error("Görsel üretilemedi.");
};

export const generateVideo = async (prompt: string): Promise<string> => {
  const ai = getGeminiClient();
  const apiKey = getApiKey();
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: prompt,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  const videoResp = await fetch(`${downloadLink}&key=${apiKey}`);
  if (!videoResp.ok) throw new Error("Video indirilemedi.");
  const blob = await videoResp.blob();
  return URL.createObjectURL(blob);
};