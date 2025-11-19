import React, { useState, useRef, useEffect } from 'react';
import { Note, COLORS } from '../types';
import { Edit2, Trash2, List, CopyPlus, CheckCircle2, Loader2, Palette } from 'lucide-react';

interface NoteItemProps {
  note: Note;
  scale: number;
  toolMode: 'select' | 'hand' | 'connect';
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onMouseUp: (e: React.MouseEvent, id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, newContent: string) => void;
  onResize: (id: string, bounds: { x: number, y: number, width: number, height: number }) => void;
  onResizeEnd: (id: string) => void;
  onOutline: (id: string) => void;
  onGenerateRelated: (id: string) => void;
  onColorChange: (id: string, newColor: string) => void;
  isOverlapTarget?: boolean;
  isSelected?: boolean;
}

export const NoteItem: React.FC<NoteItemProps> = ({
  note,
  scale,
  toolMode,
  onMouseDown,
  onMouseUp,
  onDelete,
  onEdit,
  onResize,
  onResizeEnd,
  onOutline,
  onGenerateRelated,
  onColorChange,
  isOverlapTarget,
  isSelected
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localContent, setLocalContent] = useState(note.content);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Keep track of the latest onResizeEnd to avoid stale closures in event listeners
  const onResizeEndRef = useRef(onResizeEnd);
  useEffect(() => {
    onResizeEndRef.current = onResizeEnd;
  }, [onResizeEnd]);

  // Resize Ref
  const resizeStartRef = useRef<{ 
    startX: number; 
    startY: number; 
    noteX: number; 
    noteY: number; 
    width: number; 
    height: number;
    dir: string;
  } | null>(null);

  // Sync local state with prop changes
  useEffect(() => {
    setLocalContent(note.content);
  }, [note.content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    if (localContent.trim() !== note.content) {
      onEdit(note.id, localContent);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleBlur();
    }
  };

  // Resize Handlers
  const handleResizeMouseDown = (e: React.MouseEvent, dir: string) => {
    e.stopPropagation();
    e.preventDefault(); // Prevent text selection during resize
    resizeStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
      width: note.width,
      height: note.height,
      dir
    };
    document.addEventListener('mousemove', handleResizeMouseMove);
    document.addEventListener('mouseup', handleResizeMouseUp);
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (!resizeStartRef.current) return;
    
    const { startX, startY, noteX, noteY, width, height, dir } = resizeStartRef.current;

    const screenDX = (e.clientX - startX) / scale;
    const screenDY = (e.clientY - startY) / scale;

    // Convert screen delta to local delta based on rotation
    const rad = (note.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Rotate delta vector by -rotation to get local axis alignment
    const localDX = screenDX * cos + screenDY * sin;
    const localDY = -screenDX * sin + screenDY * cos;

    let newW = width;
    let newH = height;
    let newX = noteX;
    let newY = noteY;

    const MIN_W = 180;
    const MIN_H = 140;

    // 1. Calculate Dimensions
    if (dir.includes('e')) newW = Math.max(MIN_W, width + localDX);
    if (dir.includes('w')) newW = Math.max(MIN_W, width - localDX);
    if (dir.includes('s')) newH = Math.max(MIN_H, height + localDY);
    if (dir.includes('n')) newH = Math.max(MIN_H, height - localDY);

    // 2. Calculate Position Shift (for West/North resizing)
    if (dir.includes('w')) {
        const deltaW = width - newW; 
        newX += deltaW * cos;
        newY += deltaW * sin;
    }

    if (dir.includes('n')) {
        const deltaH = height - newH;
        newX += deltaH * (-sin);
        newY += deltaH * cos;
    }

    onResize(note.id, { x: newX, y: newY, width: newW, height: newH });
  };

  const handleResizeMouseUp = () => {
    resizeStartRef.current = null;
    document.removeEventListener('mousemove', handleResizeMouseMove);
    document.removeEventListener('mouseup', handleResizeMouseUp);
    // Use ref to call the latest version of the callback
    onResizeEndRef.current(note.id);
  };

  const style: React.CSSProperties = {
    transform: `translate(${note.x}px, ${note.y}px) rotate(${note.rotation}deg)`,
    transformOrigin: 'top left', // CRITICAL for correct resize math
    zIndex: note.zIndex,
    position: 'absolute',
    width: `${note.width}px`,
    height: `${note.height}px`,
  };
  
  const cursorClass = toolMode === 'hand' 
    ? 'cursor-grab' 
    : toolMode === 'connect' 
        ? 'cursor-crosshair' 
        : 'cursor-grab active:cursor-grabbing';

  // Render Handles
  const Handle = ({ dir, cursor, className }: { dir: string, cursor: string, className: string }) => (
    <div 
      className={`absolute z-20 hover:bg-blue-400/50 transition-colors ${className}`}
      style={{ cursor }}
      onMouseDown={(e) => handleResizeMouseDown(e, dir)}
    />
  );

  return (
    <div
      style={style}
      className={`
        ${note.color} 
        shadow-lg rounded-lg flex flex-col
        transition-shadow duration-200 ease-in-out
        ${cursorClass}
        group select-none
        ${isOverlapTarget ? 'ring-4 ring-blue-400 shadow-2xl scale-105' : ''}
        ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-2 shadow-xl z-50' : 'hover:shadow-xl'}
        ${note.isProcessing ? 'opacity-80 pointer-events-none' : ''}
      `}
      onMouseDown={(e) => !isEditing && onMouseDown(e, note.id)}
      onMouseUp={(e) => onMouseUp(e, note.id)}
    >
      {/* Resize Handles */}
      {!isEditing && !note.isProcessing && toolMode === 'select' && (
          <>
            {/* Edges */}
            <Handle dir="n" cursor="ns-resize" className="-top-1 left-2 right-2 h-2" />
            <Handle dir="s" cursor="ns-resize" className="-bottom-1 left-2 right-2 h-2" />
            <Handle dir="e" cursor="ew-resize" className="-right-1 top-2 bottom-2 w-2" />
            <Handle dir="w" cursor="ew-resize" className="-left-1 top-2 bottom-2 w-2" />
            
            {/* Corners */}
            <Handle dir="nw" cursor="nwse-resize" className="-top-1 -left-1 w-3 h-3 rounded-full" />
            <Handle dir="ne" cursor="nesw-resize" className="-top-1 -right-1 w-3 h-3 rounded-full" />
            <Handle dir="sw" cursor="nesw-resize" className="-bottom-1 -left-1 w-3 h-3 rounded-full" />
            <Handle dir="se" cursor="nwse-resize" className="-bottom-1 -right-1 w-3 h-3 rounded-full" />
          </>
      )}

      {/* Selection Indicator */}
      {isSelected && (
        <div className="absolute -top-3 -left-3 z-20 bg-indigo-500 text-white rounded-full p-1 shadow-md scale-75 md:scale-100">
          <CheckCircle2 size={20} />
        </div>
      )}

      {/* Header / Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-black/5 drag-handle">
        <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
           <button
            className="p-1 hover:bg-black/10 rounded text-gray-700"
            onClick={(e) => { e.stopPropagation(); onOutline(note.id); }}
            title="아웃라인으로 변환"
          >
            <List size={14} />
          </button>
          <button
            className="p-1 hover:bg-black/10 rounded text-gray-700"
            onClick={(e) => { e.stopPropagation(); onGenerateRelated(note.id); }}
            title="연관된 노트 생성 (More like this)"
          >
            <CopyPlus size={14} />
          </button>
        </div>
        <div className="flex space-x-1">
          
          {/* Color Picker */}
          <div className={`relative transition-opacity ${showColorPicker ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <button
                className="p-1 hover:bg-black/10 rounded text-gray-700"
                onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
                title="색상 변경"
            >
                <Palette size={14} />
            </button>
            {showColorPicker && (
                <div className="absolute top-full right-0 mt-1 p-2 bg-white rounded-lg shadow-xl border border-gray-200 z-50 flex gap-1 w-[130px] flex-wrap" onMouseDown={e => e.stopPropagation()}>
                    {COLORS.map((c) => (
                        <button
                            key={c}
                            className={`w-5 h-5 rounded-full border border-gray-300 ${c} hover:scale-110 transition-transform ${note.color === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onColorChange(note.id, c);
                                setShowColorPicker(false);
                            }}
                        />
                    ))}
                </div>
            )}
          </div>

          <button
            className="p-1 hover:bg-black/10 rounded text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
            title="편집"
          >
            <Edit2 size={14} />
          </button>
          <button
            className="p-1 hover:bg-red-500/20 hover:text-red-700 rounded text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
            title="삭제"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div 
        className={`flex-1 p-4 overflow-y-auto min-h-0 scrollbar-hide relative ${toolMode === 'connect' ? 'cursor-crosshair' : ''}`}
      >
        {note.isProcessing ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-[1px]">
             <Loader2 className="animate-spin text-gray-600" size={24} />
          </div>
        ) : isEditing ? (
          <textarea
            ref={textareaRef}
            value={localContent}
            onChange={(e) => setLocalContent(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-full h-full bg-transparent outline-none resize-none font-medium text-gray-800 leading-relaxed"
            onMouseDown={(e) => e.stopPropagation()} // Keep this for text selection in edit mode
          />
        ) : (
          <div className="whitespace-pre-wrap font-medium text-gray-800 leading-relaxed text-sm">
            {note.content}
          </div>
        )}
      </div>
    </div>
  );
};