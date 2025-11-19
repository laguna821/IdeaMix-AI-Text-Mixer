import React, { useState } from 'react';
import { Send, Sparkles, Loader, Layers } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  selectedCount: number;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading, selectedCount }) => {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSend(input.trim());
      setInput('');
    }
  };

  const placeholderText = selectedCount > 0
    ? `${selectedCount}개의 메모에 대해 요청하세요 (예: 합쳐줘, 요약해줘, 반대 의견 줘)`
    : "어떤 아이디어를 떠올려볼까요? (예: 여름 휴가 계획, 새로운 앱 아이디어)";

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 md:p-6 pointer-events-none z-50 flex justify-center">
      <div className="w-full max-w-2xl pointer-events-auto">
        <form 
          onSubmit={handleSubmit}
          className="relative group"
        >
          <div className={`absolute inset-0 rounded-full blur opacity-20 group-hover:opacity-30 transition-opacity ${selectedCount > 0 ? 'bg-gradient-to-r from-indigo-500 to-pink-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'}`}></div>
          <div className={`relative flex items-center bg-white rounded-full shadow-2xl border overflow-hidden p-1.5 transition-colors duration-300 ${selectedCount > 0 ? 'border-indigo-200' : 'border-gray-200'}`}>
            <div className={`pl-4 transition-colors duration-300 ${selectedCount > 0 ? 'text-indigo-500' : 'text-gray-400'}`}>
              {selectedCount > 0 ? <Layers size={20} /> : <Sparkles size={20} />}
            </div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholderText}
              className="flex-1 px-4 py-3 outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className={`
                p-3 rounded-full transition-all duration-200
                ${input.trim() && !isLoading 
                  ? (selectedCount > 0 ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105' : 'bg-black text-white hover:scale-105')
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'}
              `}
            >
              {isLoading ? <Loader className="animate-spin" size={20} /> : <Send size={20} />}
            </button>
          </div>
        </form>
        <p className="text-center text-xs text-gray-400 mt-2 shadow-sm font-medium">
          {selectedCount > 0 
             ? `선택된 메모 ${selectedCount}개를 편집합니다.` 
             : 'Gemini 2.5 Flash로 구동됩니다.'}
        </p>
      </div>
    </div>
  );
};
