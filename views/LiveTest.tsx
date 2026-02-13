import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bot, Message } from '../types.ts';
import { createBotChat, sendMessageWithGrounding, generateImage } from '../services/geminiService.ts';
import { Chat } from '@google/genai';

interface LiveTestProps {
  bots: Bot[];
  isSidebarOpen: boolean;
  onOpenSidebar: () => void;
}

interface Attachment {
  file: File;
  preview: string;
  base64: string;
  type: string;
}

interface ProjectGroup {
  id: string;
  title: string;
  files: Record<string, string>;
  timestamp: Date;
}

interface TextSnippet {
  id: string;
  text: string;
  timestamp: Date;
}

const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', desc: 'En Gelişmiş Yazılım ve Zeka Modeli', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=flash&backgroundColor=f4f4f5' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', desc: 'Maximum Technical Depth', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=pro&backgroundColor=f4f4f5' },
  { id: 'gemini-flash-lite-latest', name: 'Gemini Flash Lite', desc: 'Optimized for Speed', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=lite&backgroundColor=f4f4f5' },
  { id: 'gemini-flash-latest', name: 'AI Studio Google', desc: 'Google AI Studio Specialized', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=google&backgroundColor=f4f4f5' },
];

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    return false;
  }
};

export default function LiveTest({ bots, onOpenSidebar }: LiveTestProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const bot = useMemo(() => bots.find(b => b.id === id), [bots, id]);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const botSwitcherRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatSession, setChatSession] = useState<Chat | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');
  
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isBotSwitcherOpen, setIsBotSwitcherOpen] = useState(false);
  const [switcherTab, setSwitcherTab] = useState<'models' | 'assistants'>('models');
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState<'files' | 'images' | 'snippets'>('files');
  const [showResetModal, setShowResetModal] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [snippets, setSnippets] = useState<TextSnippet[]>([]);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Load persistence
  useEffect(() => {
    if (!id) return;
    const savedChat = localStorage.getItem(`geminihub_chat_history_${id}`);
    if (savedChat) {
      try {
        setMessages(JSON.parse(savedChat).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
      } catch (e) {
        setMessages([{ id: 'init', role: 'model', text: `System initialized.`, timestamp: new Date() }]);
      }
    } else {
      setMessages([{ id: 'init', role: 'model', text: `System initialized.`, timestamp: new Date() }]);
    }
  }, [id]);

  // Sync state
  useEffect(() => {
    if (bot) {
      const history = messages
        .filter(m => m.id !== 'init' && m.text)
        .map(m => ({ role: m.role, parts: [{ text: m.text }] }));
      setChatSession(createBotChat(bot, history, selectedModel));
    }
  }, [id, selectedModel, bot]);

  useEffect(() => {
    if (messages.length > 0 && id) {
      localStorage.setItem(`geminihub_chat_history_${id}`, JSON.stringify(messages));
    }
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, id]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Artifact detection
  const projectGroups = useMemo(() => {
    const groups: ProjectGroup[] = [];
    messages.forEach((msg) => {
      if (msg.role === 'model' && msg.text?.includes('```')) {
        const parts = msg.text.split(/(```[\s\S]*?```)/g);
        const currentFiles: Record<string, string> = {};
        parts.forEach(part => {
          const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
          if (match) {
            const lang = (match[1] || '').toLowerCase();
            const content = match[2].trim();
            const fileName = getFilenameFromCode(content, lang);
            currentFiles[fileName] = content;
          }
        });
        if (Object.keys(currentFiles).length > 0) {
          groups.push({ id: msg.id, title: `Artifact #${groups.length + 1}`, files: currentFiles, timestamp: msg.timestamp });
        }
      }
    });
    return groups.reverse();
  }, [messages]);

  const generatedImages = useMemo(() => {
    return messages.filter(m => m.type === 'image' && m.mediaUrl).map(m => ({ id: m.id, url: m.mediaUrl!, timestamp: m.timestamp })).reverse();
  }, [messages]);

  function getFilenameFromCode(code: string, lang: string) {
    const match = code.split('\n')[0].match(/(?:filename|file|name):\s*([a-zA-Z0-9._-]+)/i);
    return match ? match[1] : `artifact.${lang || 'txt'}`;
  }

  const handleSaveSnippet = (text: string) => {
    const cleanText = text.replace(/\[GENERATE_IMAGE:.*?\]/g, '').trim();
    if (!cleanText) return;
    const newSnippet: TextSnippet = { id: Date.now().toString(), text: cleanText, timestamp: new Date() };
    setSnippets(prev => [newSnippet, ...prev]);
    setIsProjectPanelOpen(true);
    setActivePanelTab('snippets');
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (isListening) {
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.onresult = (e: any) => setInput(prev => prev + e.results[0][0].transcript);
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setAttachments([{ 
      file, 
      preview: URL.createObjectURL(file), 
      base64: (reader.result as string).split(',')[1], 
      type: file.type 
    }]);
    reader.readAsDataURL(file);
    setIsAttachmentMenuOpen(false);
  };

  const handlePinChat = () => {
    const globalPinned = JSON.parse(localStorage.getItem('geminihub_global_pinned') || '[]');
    const newItem = { id: Date.now().toString(), botId: id, name: bot?.name || 'Chat', timestamp: new Date().toISOString() };
    localStorage.setItem('geminihub_global_pinned', JSON.stringify([newItem, ...globalPinned].slice(0, 10)));
    window.dispatchEvent(new Event('pinned_updated'));
    setIsHeaderMenuOpen(false);
  };

  const send = async () => {
    if ((!input.trim() && attachments.length === 0) || !chatSession || isLoading) return;
    const userText = input; const currentAttachments = [...attachments];
    setInput(''); setAttachments([]); setIsLoading(true);
    
    setMessages(prev => [...prev, { 
      id: Date.now().toString(), 
      role: 'user', 
      text: userText, 
      timestamp: new Date(), 
      mediaUrl: currentAttachments[0]?.preview, 
      type: currentAttachments.length > 0 ? 'image' : 'text' 
    }]);

    const botMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: botMsgId, role: 'model', text: '', timestamp: new Date() }]);

    try {
      let payload = currentAttachments.length > 0 
        ? { parts: [{ text: userText || "Analyze this." }, ...currentAttachments.map(a => ({ inlineData: { data: a.base64, mimeType: a.type } }))] } 
        : userText;

      let fullText = '';
      await sendMessageWithGrounding(chatSession, payload, (chunk) => {
        fullText += chunk;
        setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: fullText } : m));
      });

      if (fullText.includes('[GENERATE_IMAGE:') && bot?.hasImageGen) {
        const match = fullText.match(/\[GENERATE_IMAGE:\s*(.*?)\]/);
        if (match) {
          const url = await generateImage(match[1]);
          setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: 'Visual asset generated.', timestamp: new Date(), type: 'image', mediaUrl: url }]);
        }
      }
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: 'Network instability detected.' } : m));
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessageContent = (msg: Message) => {
    const safeText = msg.text || '';
    if (!safeText && isLoading && msg.role === 'model') return <div className="flex gap-1 items-center"><div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce delay-75"></div><div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce delay-150"></div></div>;
    
    const cleanText = safeText.replace(/\[GENERATE_IMAGE:.*?\]/g, '').trim();
    const parts = cleanText.split(/(```[\s\S]*?```)/g);

    return (
      <div className="space-y-5">
        {msg.role === 'user' && msg.mediaUrl && <div className="max-w-[180px] rounded-xl overflow-hidden border border-zinc-100 shadow-md"><img src={msg.mediaUrl} className="w-full h-auto" /></div>}
        {parts.map((part, index) => {
          const codeMatch = part.match(/```(\w+)?\n?([\s\S]*?)```/);
          if (codeMatch) {
            const code = codeMatch[2].trim();
            const blockId = `${msg.id}-${index}`;
            const fileName = getFilenameFromCode(code, codeMatch[1] || 'code');
            return (
              <div key={index} className="my-6 border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
                <div onClick={() => setExpandedBlocks(prev => { const n = new Set(prev); if (n.has(blockId)) n.delete(blockId); else n.add(blockId); return n; })} className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                    <span className="text-[11px] font-black text-zinc-900 dark:text-zinc-100 tracking-tight uppercase">{fileName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={(e) => { e.stopPropagation(); copyToClipboard(code); }} className="p-1.5 text-zinc-400 hover:text-black dark:hover:text-white transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </button>
                    <svg className={`w-4 h-4 text-zinc-300 transition-transform ${expandedBlocks.has(blockId) ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </div>
                {expandedBlocks.has(blockId) && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/50 p-6 font-mono text-[12px] overflow-x-auto text-zinc-800 dark:text-zinc-200">
                    <code>{code}</code>
                  </div>
                )}
              </div>
            );
          }
          return <p key={index} className="whitespace-pre-wrap leading-relaxed">{part}</p>;
        })}
        {msg.role === 'model' && msg.mediaUrl && (
          <div className="mt-4 rounded-2xl overflow-hidden border border-zinc-100 dark:border-zinc-800 shadow-xl max-w-lg bg-zinc-50 dark:bg-zinc-900 relative group/media">
            <img src={msg.mediaUrl} className="w-full h-auto" />
            <div className="absolute top-4 right-4 opacity-0 group-hover/media:opacity-100 transition-opacity">
              <button onClick={() => copyToClipboard(msg.mediaUrl!)} className="w-9 h-9 bg-black/50 backdrop-blur-md text-white rounded-xl flex items-center justify-center hover:bg-black transition-all">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!bot) return <div className="flex-1 flex items-center justify-center">Loading assistant...</div>;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-zinc-950 overflow-hidden relative view-fade">
      <header className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md z-[100]">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/a/dashboard')} className="w-9 h-9 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all text-zinc-600 dark:text-zinc-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="relative" ref={botSwitcherRef}>
            <button onClick={() => setIsBotSwitcherOpen(!isBotSwitcherOpen)} className="flex items-center gap-3 px-3 py-1.5 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all group">
              <img src={bot.avatar} className="w-7 h-7 rounded-lg border border-zinc-100 dark:border-zinc-800" alt="" />
              <h2 className="text-[13px] font-black text-zinc-900 dark:text-white leading-none tracking-tight">{bot.name}</h2>
              <svg className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isBotSwitcherOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M19 9l-7 7-7-7" /></svg>
            </button>
            {isBotSwitcherOpen && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[20px] shadow-2xl z-[110] p-2 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl mb-2">
                  <button onClick={() => setSwitcherTab('models')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg ${switcherTab === 'models' ? 'bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm' : 'text-zinc-500'}`}>Model</button>
                  <button onClick={() => setSwitcherTab('assistants')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg ${switcherTab === 'assistants' ? 'bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm' : 'text-zinc-500'}`}>Assistant</button>
                </div>
                <div className="space-y-1 max-h-80 overflow-y-auto custom-scrollbar">
                  {switcherTab === 'models' ? GEMINI_MODELS.map(m => (
                    <button key={m.id} onClick={() => { setSelectedModel(m.id); setIsBotSwitcherOpen(false); }} className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors ${selectedModel === m.id ? 'bg-zinc-50 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
                      <img src={m.avatar} className="w-7 h-7 rounded-lg border border-zinc-100 dark:border-zinc-800" alt="" />
                      <div className="flex-1 text-left"><p className={`text-[11px] font-bold ${selectedModel === m.id ? 'text-black dark:text-white' : 'text-zinc-500'}`}>{m.name}</p></div>
                    </button>
                  )) : bots.map(b => (
                    <button key={b.id} onClick={() => { navigate(`/a/test/${b.id}`); setIsBotSwitcherOpen(false); }} className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors ${id === b.id ? 'bg-zinc-50 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
                      <img src={b.avatar} className="w-7 h-7 rounded-lg border border-zinc-100 dark:border-zinc-800" alt="" />
                      <div className="flex-1 text-left"><p className={`text-[11px] font-bold ${id === b.id ? 'text-black dark:text-white' : 'text-zinc-500'}`}>{b.name}</p></div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="relative" ref={headerMenuRef}>
          <button onClick={() => setIsHeaderMenuOpen(!isHeaderMenuOpen)} className="w-9 h-9 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" /></svg>
          </button>
          {isHeaderMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl shadow-xl z-[110] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <button onClick={handlePinChat} className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[11px] font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg>Pin Chat
              </button>
              <button onClick={() => { setIsHeaderMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[11px] font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>Export PDF
              </button>
              <div className="h-px bg-zinc-100 dark:bg-zinc-800 mx-2"></div>
              <button onClick={() => { setShowResetModal(true); setIsHeaderMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[11px] font-bold text-red-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>Reset Chat
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-12 lg:px-32 py-10 space-y-12 custom-scrollbar bg-white dark:bg-zinc-950">
          {messages.map((msg) => (
            <div key={msg.id} className="max-w-4xl mx-auto space-y-3 relative group/msg animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-3 mb-1">
                <span className={`text-[9px] font-bold uppercase tracking-[0.2em] ${msg.role === 'user' ? 'text-zinc-400' : 'text-black dark:text-white font-black'}`}>
                  {msg.role === 'user' ? 'Identity_Module' : bot.name}
                </span>
                <span className="text-[9px] text-zinc-300 font-bold">{msg.timestamp.toLocaleTimeString()}</span>
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                   <button onClick={() => handleSaveSnippet(msg.text)} className="p-1 text-zinc-400 hover:text-indigo-500 transition-colors" title="Save Snippet"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg></button>
                   <button onClick={() => { copyToClipboard(msg.text); setCopiedMsgId(msg.id); setTimeout(() => setCopiedMsgId(null), 2000); }} className={`p-1 transition-colors ${copiedMsgId === msg.id ? 'text-green-500' : 'text-zinc-400 hover:text-black dark:hover:text-white'}`}>
                      {copiedMsgId === msg.id ? <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M5 13l4 4L19 7" /></svg> : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                   </button>
                </div>
              </div>
              <div className="text-zinc-700 dark:text-zinc-300 text-[14px] font-medium leading-relaxed">
                {renderMessageContent(msg)}
              </div>
            </div>
          ))}
        </div>

        <aside className={`absolute top-0 right-0 h-full w-80 bg-zinc-50 dark:bg-zinc-900 border-l border-zinc-100 dark:border-zinc-800 transition-transform duration-500 z-[90] shadow-2xl flex flex-col ${isProjectPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
           <div className="px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <button onClick={() => setActivePanelTab('files')} className={`p-2 rounded-xl transition-all ${activePanelTab === 'files' ? 'bg-black dark:bg-white text-white dark:text-black' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg></button>
                 <button onClick={() => setActivePanelTab('images')} className={`p-2 rounded-xl transition-all ${activePanelTab === 'images' ? 'bg-black dark:bg-white text-white dark:text-black' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></button>
                 <button onClick={() => setActivePanelTab('snippets')} className={`p-2 rounded-xl transition-all ${activePanelTab === 'snippets' ? 'bg-black dark:bg-white text-white dark:text-black' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg></button>
              </div>
              <button onClick={() => setIsProjectPanelOpen(false)} className="text-zinc-400 hover:text-black dark:hover:text-white transition-colors"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M6 18L18 6M6 6l12 12" /></svg></button>
           </div>
           <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {activePanelTab === 'files' ? (
                <div className="space-y-4">
                   {projectGroups.map(group => (
                     <div key={group.id} className="bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
                        <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-700 border-b border-zinc-100 dark:border-zinc-700 text-[9px] font-black uppercase text-zinc-400">{group.timestamp.toLocaleTimeString()}</div>
                        {Object.keys(group.files).map(name => (
                          <div key={name} onClick={() => { localStorage.setItem('preview_files_' + id, JSON.stringify(group.files)); navigate('/a/code-manager'); }} className="p-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-700 cursor-pointer text-[11px] font-bold text-zinc-700 dark:text-zinc-200 border-b border-zinc-50 dark:border-zinc-700 last:border-0">{name}</div>
                        ))}
                     </div>
                   ))}
                </div>
              ) : activePanelTab === 'images' ? (
                <div className="grid grid-cols-2 gap-3">
                   {generatedImages.map(img => (
                     <div key={img.id} className="aspect-square rounded-xl overflow-hidden bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700"><img src={img.url} className="w-full h-full object-cover" /></div>
                   ))}
                </div>
              ) : (
                <div className="space-y-3">
                   {snippets.map(s => (
                     <div key={s.id} className="p-4 bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-2xl shadow-sm"><p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 line-clamp-4 leading-relaxed">{s.text}</p></div>
                   ))}
                </div>
              )}
           </div>
        </aside>

        {!isProjectPanelOpen && (projectGroups.length > 0 || generatedImages.length > 0 || snippets.length > 0) && (
          <button onClick={() => setIsProjectPanelOpen(true)} className="absolute top-10 right-10 z-[80] p-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl shadow-2xl hover:bg-zinc-800 dark:hover:bg-zinc-100 active:scale-95 transition-all">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        )}
      </div>

      <footer className="shrink-0 bg-white dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-800 p-4 md:p-6 z-[100]">
        <div className="max-w-4xl mx-auto">
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-4">
              {attachments.map((attr, i) => (
                <div key={i} className="relative w-14 h-14 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden shadow-sm animate-in zoom-in-50 duration-200">
                  <img src={attr.preview} className="w-full h-full object-cover" />
                  <button onClick={() => setAttachments([])} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/80 text-white rounded-full flex items-center justify-center text-[10px]"><svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>
              ))}
            </div>
          )}
          <div className="relative border border-zinc-200 dark:border-zinc-700 rounded-2xl bg-white dark:bg-zinc-900 p-4 focus-within:border-black dark:focus-within:border-white shadow-sm transition-all">
            <textarea 
              ref={textareaRef} 
              rows={1} 
              value={input} 
              onChange={e => setInput(e.target.value)} 
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} 
              placeholder="Query technical studio..." 
              className="w-full bg-transparent outline-none text-[14px] font-medium text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 resize-none min-h-[44px] max-h-[200px] mb-2 custom-scrollbar leading-relaxed" 
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 pl-1" ref={attachmentMenuRef}>
                <button onClick={() => setIsAttachmentMenuOpen(!isAttachmentMenuOpen)} className="text-zinc-400 hover:text-black dark:hover:text-white transition-colors p-1" title="Attachments">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                </button>
                {isAttachmentMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-3 w-48 bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-2xl shadow-2xl z-[120] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <button onClick={() => { cameraInputRef.current?.click(); }} className="w-full flex items-center gap-3 px-4 py-3.5 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /></svg>Camera
                    </button>
                    <button onClick={() => { fileInputRef.current?.click(); }} className="w-full flex items-center gap-3 px-4 py-3.5 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Upload File
                    </button>
                  </div>
                )}
                <button onClick={toggleListening} className={`p-1 transition-all ${isListening ? 'text-red-500 animate-pulse' : 'text-zinc-400 hover:text-black dark:hover:text-white'}`} title="Voice Input">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
                </button>
              </div>
              <button onClick={send} disabled={isLoading || (!input.trim() && attachments.length === 0)} className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all active:scale-95 ${input.trim() || attachments.length > 0 ? 'bg-black dark:bg-white text-white dark:text-black shadow-lg shadow-zinc-200 dark:shadow-none' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </button>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="*/*" />
            <input type="file" ref={cameraInputRef} onChange={handleFileSelect} className="hidden" accept="image/*" capture="environment" />
          </div>
        </div>
      </footer>

      {showResetModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-zinc-950/30 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[32px] p-8 max-w-[400px] w-full text-center space-y-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="space-y-2">
               <h3 className="text-2xl font-black tracking-tight text-black dark:text-white">Clear entire chat?</h3>
               <p className="text-[13px] text-zinc-500 font-medium">This will permanently delete the current session history and artifacts.</p>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowResetModal(false)} className="flex-1 px-6 py-4 border border-zinc-100 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-2xl text-[12px] font-bold hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
              <button onClick={() => { setMessages([]); localStorage.removeItem(`geminihub_chat_history_${id}`); setShowResetModal(false); setMessages([{ id: 'reset', role: 'model', text: 'History purged. Engine operational.', timestamp: new Date() }]); }} className="flex-1 px-6 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-[12px] font-bold active:scale-95 shadow-xl transition-all">Clear Now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
