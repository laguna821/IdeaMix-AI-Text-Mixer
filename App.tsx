import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Note, DragState, COLORS, SelectionBox, SnapLine, Connection } from './types';
import { generateIdeas, mergeNotes, transformNotes, formatToOutline, generateRelatedNotes } from './services/gemini';
import { NoteItem } from './components/NoteItem';
import { ChatInput } from './components/ChatInput';
import { Eraser, Info, Download, MousePointer2, Hand, ZoomIn, ZoomOut, Maximize, Network, Undo2, Redo2, ImageDown } from 'lucide-react';

const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 160;
const NOTE_GAP = 24; // Minimum space between notes

const COLOR_HEX_MAP: Record<string, string> = {
  'bg-yellow-200': '#fef08a',
  'bg-green-200': '#bbf7d0',
  'bg-blue-200': '#bfdbfe',
  'bg-red-200': '#fecaca',
  'bg-purple-200': '#e9d5ff',
  'bg-orange-200': '#fed7aa',
  'bg-pink-200': '#fbcfe8',
  'bg-teal-200': '#99f6e4',
  'default': '#fdf6e3'
};

// Helper to escape special characters for XML/SVG
const escapeXml = (unsafe: string) => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
};

interface HistoryStep {
    notes: Note[];
    connections: Connection[];
}

const App: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Refs for Async Access (Fix for Stale State / Undo Bugs)
  const notesRef = useRef(notes);
  const connectionsRef = useRef(connections);
  
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  // History State
  const [history, setHistory] = useState<HistoryStep[]>([{ notes: [], connections: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Viewport & Tool State
  const [viewState, setViewState] = useState({ x: 0, y: 0, scale: 1 });
  const [toolMode, setToolMode] = useState<'select' | 'hand' | 'connect'>('select');
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number, y: number } | null>(null);

  // Connection State
  const [connectionStartId, setConnectionStartId] = useState<string | null>(null);
  const [dragTargetPos, setDragTargetPos] = useState<{ x: number, y: number } | null>(null);

  // Selection State
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<SelectionBox>({
    startX: 0, startY: 0, currentX: 0, currentY: 0, width: 0, height: 0, isVisible: false
  });

  // Drag State (for notes)
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    noteId: null,
    startX: 0, // Screen Coordinates
    startY: 0, // Screen Coordinates
    initialNoteX: 0,
    initialNoteY: 0,
  });

  // Snapping State
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  
  // For collision detection visualization
  const [overlapTargetId, setOverlapTargetId] = useState<string | null>(null);
  
  const nextZIndex = useRef(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- History Helpers ---
  
  const pushHistory = useCallback((newNotes: Note[], newConnections: Connection[]) => {
    if (!newNotes || !newConnections) return;
    setHistory(prev => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push({ notes: newNotes, connections: newConnections });
        return newHistory;
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // Ref to access latest pushHistory in async callbacks
  const pushHistoryRef = useRef(pushHistory);
  useEffect(() => {
    pushHistoryRef.current = pushHistory;
  }, [pushHistory]);

  const undo = () => {
    if (historyIndex > 0) {
        const prevStep = history[historyIndex - 1];
        if (prevStep && prevStep.notes) {
            setNotes(prevStep.notes);
            setConnections(prevStep.connections || []);
            setHistoryIndex(historyIndex - 1);
        }
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
        const nextStep = history[historyIndex + 1];
        if (nextStep && nextStep.notes) {
            setNotes(nextStep.notes);
            setConnections(nextStep.connections || []);
            setHistoryIndex(historyIndex + 1);
        }
    }
  };

  // --- Coordinate Helpers ---
  const screenToWorld = (screenX: number, screenY: number) => {
    return {
      x: (screenX - viewState.x) / viewState.scale,
      y: (screenY - viewState.y) / viewState.scale
    };
  };

  const getNoteCenter = (note: Note) => ({
    x: note.x + note.width / 2,
    y: note.y + note.height / 2
  });

  // --- Placement Helpers ---

  const checkCollision = (x: number, y: number, w: number, h: number, existingNotes: Note[]) => {
    return existingNotes.some(note => {
      return (
        x < note.x + note.width + NOTE_GAP &&
        x + w + NOTE_GAP > note.x &&
        y < note.y + note.height + NOTE_GAP &&
        y + h + NOTE_GAP > note.y
      );
    });
  };

  const findAvailablePosition = (
    width: number, 
    height: number, 
    existingNotes: Note[], 
    startX: number, 
    startY: number
  ): { x: number, y: number } => {
    let x = startX;
    let y = startY;
    
    if (!checkCollision(x, y, width, height, existingNotes)) {
      return { x, y };
    }

    // Spiral search parameters
    let angle = 0;
    let radius = 0;
    const angleIncrement = 0.5; // Radians
    const radiusIncrement = 10; 
    const maxIterations = 500; 

    for (let i = 0; i < maxIterations; i++) {
      angle += angleIncrement;
      radius = 50 + (angle * radiusIncrement); 
      
      x = startX + radius * Math.cos(angle);
      y = startY + radius * Math.sin(angle);

      if (!checkCollision(x, y, width, height, existingNotes)) {
        return { x, y };
      }
    }

    return { 
      x: startX + (Math.random() * 100), 
      y: startY + (Math.random() * 100) 
    };
  };

  // --- Layout & Export Helpers ---

  // Helper to untangle overlapping notes
  const resolveCollisions = (currentNotes: Note[]): Note[] => {
    let newNotes = currentNotes.map(n => ({...n}));
    const iterations = 50;

    for (let iter = 0; iter < iterations; iter++) {
      let changed = false;
      for (let i = 0; i < newNotes.length; i++) {
        for (let j = i + 1; j < newNotes.length; j++) {
          const a = newNotes[i];
          const b = newNotes[j];
          
          const centerA = { x: a.x + a.width/2, y: a.y + a.height/2 };
          const centerB = { x: b.x + b.width/2, y: b.y + b.height/2 };
          
          const dx = centerA.x - centerB.x;
          const dy = centerA.y - centerB.y;
          
          const minDistX = (a.width + b.width)/2 + NOTE_GAP;
          const minDistY = (a.height + b.height)/2 + NOTE_GAP;

          if (Math.abs(dx) < minDistX && Math.abs(dy) < minDistY) {
             const overlapX = minDistX - Math.abs(dx);
             const overlapY = minDistY - Math.abs(dy);

             if (overlapX < overlapY) {
                const sign = dx === 0 ? (Math.random() - 0.5) : Math.sign(dx); 
                const push = overlapX / 2;
                a.x += push * sign;
                b.x -= push * sign;
             } else {
                const sign = dy === 0 ? (Math.random() - 0.5) : Math.sign(dy);
                const push = overlapY / 2;
                a.y += push * sign;
                b.y -= push * sign;
             }
             changed = true;
          }
        }
      }
      if (!changed) break;
    }
    return newNotes;
  };

  // Calculate Viewport transform to fit all notes
  const getFittedView = (notesToFit: Note[]) => {
      if (notesToFit.length === 0) return { x: 0, y: 0, scale: 1 };

      const minX = Math.min(...notesToFit.map(n => n.x));
      const maxX = Math.max(...notesToFit.map(n => n.x + n.width));
      const minY = Math.min(...notesToFit.map(n => n.y));
      const maxY = Math.max(...notesToFit.map(n => n.y + n.height));

      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      const padding = 100;

      const scaleX = window.innerWidth / (contentWidth + padding * 2);
      const scaleY = window.innerHeight / (contentHeight + padding * 2);
      const newScale = Math.min(Math.min(scaleX, scaleY), 1); 

      const contentCenterX = minX + contentWidth / 2;
      const contentCenterY = minY + contentHeight / 2;

      const newX = (window.innerWidth / 2) - (contentCenterX * newScale);
      const newY = (window.innerHeight / 2) - (contentCenterY * newScale);
      
      return { x: newX, y: newY, scale: newScale };
  };

  // --- View Control ---
  const zoomIn = () => setViewState(prev => ({ ...prev, scale: Math.min(3, prev.scale + 0.1) }));
  const zoomOut = () => setViewState(prev => ({ ...prev, scale: Math.max(0.2, prev.scale - 0.1) }));
  
  const handleAutoFit = () => {
    const newNotes = resolveCollisions(notes);
    const newView = getFittedView(newNotes);
    
    setNotes(newNotes);
    setViewState(newView);
    pushHistory(newNotes, connections);
  };

  const handleExportSVG = () => {
    if (notes.length === 0) return;

    // 1. Resolve Collisions (Auto-Arrange)
    const arrangedNotes = resolveCollisions(notes);
    
    // 2. Update State + History
    setNotes(arrangedNotes);
    const fittedView = getFittedView(arrangedNotes);
    setViewState(fittedView);
    pushHistory(arrangedNotes, connections);

    // 3. Calculate SVG Bounds
    const minX = Math.min(...arrangedNotes.map(n => n.x)) - 50;
    const minY = Math.min(...arrangedNotes.map(n => n.y)) - 50;
    const maxX = Math.max(...arrangedNotes.map(n => n.x + n.width)) + 50;
    const maxY = Math.max(...arrangedNotes.map(n => n.y + n.height)) + 50;
    const width = maxX - minX;
    const height = maxY - minY;

    // 4. Build SVG
    // Note: & must be escaped as &amp; in XML attributes and PCDATA
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">
        <defs>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&amp;display=swap');
                .note-text { font-family: 'Inter', sans-serif; font-size: 14px; color: #1f2937; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
            </style>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
            </marker>
        </defs>
        <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#f3f4f6"/>
        
        <!-- Connections -->
        ${connections.map(conn => {
            const from = arrangedNotes.find(n => n.id === conn.fromId);
            const to = arrangedNotes.find(n => n.id === conn.toId);
            if (!from || !to) return '';
            const startX = from.x + from.width / 2;
            const startY = from.y + from.height / 2;
            const endX = to.x + to.width / 2;
            const endY = to.y + to.height / 2;
            return `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="#94a3b8" stroke-width="2" />`;
        }).join('')}

        <!-- Notes -->
        ${arrangedNotes.map(note => {
            const bgColor = COLOR_HEX_MAP[note.color] || '#ffffff';
            // Use escapeXml to sanitize content
            return `
            <g transform="translate(${note.x}, ${note.y}) rotate(${note.rotation})">
                <foreignObject width="${note.width}" height="${note.height}">
                    <div xmlns="http://www.w3.org/1999/xhtml" style="
                        width: 100%;
                        height: 100%;
                        background-color: ${bgColor};
                        border-radius: 8px;
                        padding: 16px;
                        box-sizing: border-box;
                        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                        display: flex;
                        flex-direction: column;
                    ">
                        <div class="note-text" style="flex: 1; overflow: hidden;">${escapeXml(note.content)}</div>
                    </div>
                </foreignObject>
            </g>
            `;
        }).join('')}
      </svg>
    `;

    // 5. Download
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ideamix-board-${new Date().toISOString().slice(0,10)}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Handlers ---

  const handleChatAction = async (prompt: string) => {
    setIsGenerating(true);
    
    try {
      let updatedNotes = [...notesRef.current]; // Use Ref for latest state
      
      // Case 1: Context aware transformation
      if (selectedNoteIds.size > 0) {
        const selectedNotes = updatedNotes.filter(n => selectedNoteIds.has(n.id));
        const selectedContents = selectedNotes.map(n => n.content);
        
        const newIdeaContents = await transformNotes(selectedContents, prompt);
        
        if (newIdeaContents.length > 0) {
           // Refetch state in case it changed during await
           updatedNotes = [...notesRef.current];
           
          const minX = Math.min(...selectedNotes.map(n => n.x));
          const maxX = Math.max(...selectedNotes.map(n => n.x));
          const minY = Math.min(...selectedNotes.map(n => n.y));
          const maxY = Math.max(...selectedNotes.map(n => n.y));
          
          const centerX = (minX + maxX) / 2 - DEFAULT_WIDTH / 2 + DEFAULT_WIDTH; 
          const centerY = (minY + maxY) / 2;

          const newNotes: Note[] = [];
          
          for (const content of newIdeaContents) {
             const pos = findAvailablePosition(DEFAULT_WIDTH, DEFAULT_HEIGHT, updatedNotes, centerX, centerY);
             
             const newNote: Note = {
               id: crypto.randomUUID(),
               content,
               x: pos.x,
               y: pos.y,
               width: DEFAULT_WIDTH,
               height: DEFAULT_HEIGHT,
               rotation: Math.random() * 4 - 2, 
               color: COLORS[Math.floor(Math.random() * COLORS.length)],
               zIndex: nextZIndex.current++,
             };

             newNotes.push(newNote);
             updatedNotes.push(newNote);
          }
          setNotes(updatedNotes);
          pushHistory(updatedNotes, connectionsRef.current);
        }
      } 
      // Case 2: Generate new ideas
      else {
        const worldCenter = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const centerX = worldCenter.x - DEFAULT_WIDTH / 2;
        const centerY = worldCenter.y - DEFAULT_HEIGHT / 2;

        const ideas = await generateIdeas(prompt);
        
        // Refetch state
        updatedNotes = [...notesRef.current];
        const newNotes: Note[] = [];

        for (const idea of ideas) {
           const pos = findAvailablePosition(DEFAULT_WIDTH, DEFAULT_HEIGHT, updatedNotes, centerX, centerY);
           
           const newNote: Note = {
             id: crypto.randomUUID(),
             content: idea,
             x: pos.x,
             y: pos.y,
             width: DEFAULT_WIDTH,
             height: DEFAULT_HEIGHT,
             rotation: Math.random() * 4 - 2,
             color: COLORS[Math.floor(Math.random() * COLORS.length)],
             zIndex: nextZIndex.current++,
           };

           newNotes.push(newNote);
           updatedNotes.push(newNote);
        }
        setNotes(updatedNotes);
        pushHistory(updatedNotes, connectionsRef.current);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDelete = (id: string) => {
    const newNotes = notes.filter((n) => n.id !== id);
    const newConnections = connections.filter(c => c.fromId !== id && c.toId !== id);
    setNotes(newNotes);
    setConnections(newConnections);
    setSelectedNoteIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
    });
    pushHistory(newNotes, newConnections);
  };

  const handleEdit = (id: string, newContent: string) => {
    const newNotes = notes.map(n => n.id === id ? { ...n, content: newContent } : n);
    setNotes(newNotes);
    pushHistory(newNotes, connections);
  };

  const handleResize = (id: string, bounds: { x: number, y: number, width: number, height: number }) => {
    setNotes((prev) => prev.map(n => n.id === id ? { ...n, ...bounds } : n));
  };
  
  const handleResizeEnd = (id: string) => {
    pushHistory(notes, connections);
  };
  
  const handleColorChange = (id: string, newColor: string) => {
    const newNotes = notes.map(n => n.id === id ? { ...n, color: newColor } : n);
    setNotes(newNotes);
    pushHistory(newNotes, connections);
  };

  const handleOutline = async (id: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    setNotes(prev => prev.map(n => n.id === id ? { ...n, isProcessing: true } : n));
    try {
      const newContent = await formatToOutline(note.content);
      const newNotes = notesRef.current.map(n => n.id === id ? { ...n, content: newContent, isProcessing: false } : n);
      setNotes(newNotes);
      pushHistory(newNotes, connectionsRef.current);
    } catch (error) {
      setNotes(prev => prev.map(n => n.id === id ? { ...n, isProcessing: false } : n));
    }
  };

  const handleGenerateRelated = async (id: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    setNotes(prev => prev.map(n => n.id === id ? { ...n, isProcessing: true } : n));
    try {
      const relatedIdeas = await generateRelatedNotes(note.content);
      
      // Use ref for latest state
      const currentNotes = [...notesRef.current];
      const currentNote = currentNotes.find(n => n.id === id);
      if (!currentNote) return; // Note was deleted

      const startX = currentNote.x + currentNote.width + 50;
      const startY = currentNote.y;
      const newNotes: Note[] = [];
      
      for (const content of relatedIdeas) {
          const pos = findAvailablePosition(DEFAULT_WIDTH, DEFAULT_HEIGHT, currentNotes, startX, startY);
          const newNote: Note = {
             id: crypto.randomUUID(),
             content,
             x: pos.x,
             y: pos.y,
             width: DEFAULT_WIDTH,
             height: DEFAULT_HEIGHT,
             rotation: Math.random() * 4 - 2,
             color: COLORS[Math.floor(Math.random() * COLORS.length)],
             zIndex: nextZIndex.current++,
          };
          newNotes.push(newNote);
          currentNotes.push(newNote);
      }
      
      const finalNotes = currentNotes.map(n => n.id === id ? { ...n, isProcessing: false } : n);
      
      setNotes(finalNotes);
      pushHistory(finalNotes, connectionsRef.current);

    } catch (error) {
      setNotes(prev => prev.map(n => n.id === id ? { ...n, isProcessing: false } : n));
    }
  };

  const clearAll = () => {
    if(confirm('모든 메모를 지우시겠습니까?')) {
      setNotes([]);
      setConnections([]);
      setSelectedNoteIds(new Set());
      pushHistory([], []);
    }
  };

  const deleteSelected = () => {
    if (selectedNoteIds.size === 0) return;
    if (confirm(`선택한 ${selectedNoteIds.size}개의 메모를 삭제하시겠습니까?`)) {
        const newNotes = notes.filter(n => !selectedNoteIds.has(n.id));
        const newConnections = connections.filter(c => !selectedNoteIds.has(c.fromId) && !selectedNoteIds.has(c.toId));
        setNotes(newNotes);
        setConnections(newConnections);
        setSelectedNoteIds(new Set());
        pushHistory(newNotes, newConnections);
    }
  };

  const downloadMarkdown = () => {
    if (selectedNoteIds.size === 0) return;
    const selectedNotes = notes
      .filter(n => selectedNoteIds.has(n.id))
      .sort((a, b) => {
        const bandA = Math.floor(a.y / 100);
        const bandB = Math.floor(b.y / 100);
        if (bandA !== bandB) return bandA - bandB;
        return a.x - b.x;
      });
    if (selectedNotes.length === 0) return;
    const date = new Date().toISOString().split('T')[0];
    let markdownContent = `# IdeaMix Export - ${date}\n\n`;
    selectedNotes.forEach((note, index) => {
      markdownContent += `## Note ${index + 1}\n\n${note.content}\n\n---\n\n`;
    });
    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ideamix-export-${date}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- Mouse Interactions ---

  const handleStageMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || 
        (e.target as HTMLElement).closest('input') || 
        (e.target as HTMLElement).closest('textarea')) return;

    // PAN MODE LOGIC
    if (toolMode === 'hand') {
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };
        return;
    }

    // SELECT MODE LOGIC
    if (toolMode === 'select') {
        // Clear selection if not holding shift
        if (!e.shiftKey) {
            setSelectedNoteIds(new Set());
        }

        // Start Selection Box in WORLD coordinates
        const worldPos = screenToWorld(e.clientX, e.clientY);
        setSelectionBox({
            startX: worldPos.x,
            startY: worldPos.y,
            currentX: worldPos.x,
            currentY: worldPos.y,
            width: 0,
            height: 0,
            isVisible: true
        });
    }
  };

  const handleNoteMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); 
    
    // Hand Mode: Ignore direct note interaction (let stage handle pan)
    if (toolMode === 'hand') {
        handleStageMouseDown(e);
        return;
    }

    // Connect Mode: Start Dragging Connection
    if (toolMode === 'connect') {
        setConnectionStartId(id);
        const worldPos = screenToWorld(e.clientX, e.clientY);
        setDragTargetPos(worldPos);
        return;
    }

    // Select Mode: Note Selection & Drag Logic
    if (!e.shiftKey && !selectedNoteIds.has(id)) {
       setSelectedNoteIds(new Set([id]));
    } else if (e.shiftKey) {
       setSelectedNoteIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
       });
    }
    
    setNotes((prev) => 
      prev.map((n) => n.id === id ? { ...n, zIndex: nextZIndex.current++ } : n)
    );

    const note = notes.find(n => n.id === id);
    setDragState({
      isDragging: true,
      noteId: id,
      startX: e.clientX, // Keep screen coords for drag delta
      startY: e.clientY,
      initialNoteX: note?.x || 0,
      initialNoteY: note?.y || 0,
    });
  };

  const handleNoteMouseUp = (e: React.MouseEvent, id: string) => {
    if (toolMode === 'connect' && connectionStartId) {
        e.stopPropagation();
        if (connectionStartId !== id) {
            let newConnections = [...connections];
            // Check if connection exists
            const exists = connections.find(
                c => (c.fromId === connectionStartId && c.toId === id) || 
                     (c.fromId === id && c.toId === connectionStartId)
            );

            if (exists) {
                // Remove existing connection (toggle)
                newConnections = newConnections.filter(c => c.id !== exists.id);
            } else {
                // Create new connection
                newConnections.push({
                    id: crypto.randomUUID(),
                    fromId: connectionStartId,
                    toId: id
                });
            }
            setConnections(newConnections);
            pushHistory(notes, newConnections);
        }
        setConnectionStartId(null);
        setDragTargetPos(null);
        setOverlapTargetId(null);
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    // 1. Panning
    if (isPanning && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        
        setViewState(prev => ({
            ...prev,
            x: prev.x + dx,
            y: prev.y + dy
        }));
        
        panStartRef.current = { x: e.clientX, y: e.clientY };
        return;
    }

    // 2. Connection Dragging
    if (toolMode === 'connect' && connectionStartId) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        setDragTargetPos(worldPos);
        
        // Detect hover over potential target note
        const cursorX = worldPos.x;
        const cursorY = worldPos.y;
        const target = notes.find(n => 
            n.id !== connectionStartId &&
            cursorX >= n.x && cursorX <= n.x + n.width &&
            cursorY >= n.y && cursorY <= n.y + n.height
        );
        
        setOverlapTargetId(target ? target.id : null);
        
        return;
    }

    // 3. Selection Box
    if (selectionBox.isVisible) {
      const worldPos = screenToWorld(e.clientX, e.clientY);
      setSelectionBox(prev => ({
        ...prev,
        currentX: worldPos.x,
        currentY: worldPos.y,
        width: Math.abs(worldPos.x - prev.startX),
        height: Math.abs(worldPos.y - prev.startY)
      }));
    } 
    // 4. Note Dragging
    else if (dragState.isDragging && dragState.noteId) {
      // Apply Scale to Delta
      const dx = (e.clientX - dragState.startX) / viewState.scale;
      const dy = (e.clientY - dragState.startY) / viewState.scale;
      
      let targetX = dragState.initialNoteX + dx;
      let targetY = dragState.initialNoteY + dy;

      // SNAP LOGIC
      const activeNote = notes.find(n => n.id === dragState.noteId);
      let newSnapLines: SnapLine[] = [];

      if (activeNote) {
        const SNAP_DIST = 12; // Snap distance is constant in world units
        let closestX = SNAP_DIST;
        let closestY = SNAP_DIST;
        let snappedX = targetX;
        let snappedY = targetY;

        notes.forEach(other => {
           if (other.id === dragState.noteId || other.isProcessing) return;

           // X Snapping
           const otherL = other.x;
           const otherR = other.x + other.width;
           const myW = activeNote.width;
           
           if (Math.abs(targetX - otherL) < closestX) {
              closestX = Math.abs(targetX - otherL);
              snappedX = otherL;
              newSnapLines = newSnapLines.filter(l => l.type !== 'vertical');
              newSnapLines.push({ type: 'vertical', position: otherL });
           }
           if (Math.abs(targetX - otherR) < closestX) {
              closestX = Math.abs(targetX - otherR);
              snappedX = otherR;
              newSnapLines = newSnapLines.filter(l => l.type !== 'vertical');
              newSnapLines.push({ type: 'vertical', position: otherR });
           }
           if (Math.abs((targetX + myW) - otherL) < closestX) {
              closestX = Math.abs((targetX + myW) - otherL);
              snappedX = otherL - myW;
              newSnapLines = newSnapLines.filter(l => l.type !== 'vertical');
              newSnapLines.push({ type: 'vertical', position: otherL });
           }
           if (Math.abs((targetX + myW) - otherR) < closestX) {
              closestX = Math.abs((targetX + myW) - otherR);
              snappedX = otherR - myW;
              newSnapLines = newSnapLines.filter(l => l.type !== 'vertical');
              newSnapLines.push({ type: 'vertical', position: otherR });
           }
           
           // Y Snapping
           const otherT = other.y;
           const otherB = other.y + other.height;
           const myH = activeNote.height;

           if (Math.abs(targetY - otherT) < closestY) {
              closestY = Math.abs(targetY - otherT);
              snappedY = otherT;
              newSnapLines = newSnapLines.filter(l => l.type !== 'horizontal');
              newSnapLines.push({ type: 'horizontal', position: otherT });
           }
           if (Math.abs(targetY - otherB) < closestY) {
              closestY = Math.abs(targetY - otherB);
              snappedY = otherB;
              newSnapLines = newSnapLines.filter(l => l.type !== 'horizontal');
              newSnapLines.push({ type: 'horizontal', position: otherB });
           }
           if (Math.abs((targetY + myH) - otherT) < closestY) {
              closestY = Math.abs((targetY + myH) - otherT);
              snappedY = otherT - myH;
              newSnapLines = newSnapLines.filter(l => l.type !== 'horizontal');
              newSnapLines.push({ type: 'horizontal', position: otherT });
           }
           if (Math.abs((targetY + myH) - otherB) < closestY) {
              closestY = Math.abs((targetY + myH) - otherB);
              snappedY = otherB - myH;
              newSnapLines = newSnapLines.filter(l => l.type !== 'horizontal');
              newSnapLines.push({ type: 'horizontal', position: otherB });
           }
        });
        
        targetX = snappedX;
        targetY = snappedY;
      }
      
      setSnapLines(newSnapLines);

      setNotes((prev) => {
        return prev.map((n) =>
          n.id === dragState.noteId
            ? { ...n, x: targetX, y: targetY }
            : n
        );
      });

      if (activeNote) {
         const activeCenter = { x: targetX + activeNote.width/2, y: targetY + activeNote.height/2 };
         
         const target = notes.find(other => {
            if (other.id === activeNote.id || other.isProcessing) return false;
            const otherCenter = { x: other.x + other.width/2, y: other.y + other.height/2 };
            const distance = Math.hypot(activeCenter.x - otherCenter.x, activeCenter.y - otherCenter.y);
            const threshold = (Math.min(activeNote.width, activeNote.height) + Math.min(other.width, other.height)) / 4;
            return distance < Math.max(80, threshold); 
         });

         setOverlapTargetId(target ? target.id : null);
      }
    }
  }, [dragState, selectionBox, notes, selectedNoteIds, isPanning, viewState, toolMode, connectionStartId]); 

  const handleStageMouseUp = (e: React.MouseEvent) => {
      setSnapLines([]);
      setIsPanning(false);
      panStartRef.current = null;
      
      // Finalize Connect Drag (Cancel if invalid drop)
      if (toolMode === 'connect' && connectionStartId) {
          setConnectionStartId(null);
          setDragTargetPos(null);
          setOverlapTargetId(null);
      }

      // Finalize Selection
      if (selectionBox.isVisible) {
          // Box is already in World Coords
          const sbLeft = Math.min(selectionBox.startX, selectionBox.currentX);
          const sbTop = Math.min(selectionBox.startY, selectionBox.currentY);
          const sbRight = Math.max(selectionBox.startX, selectionBox.currentX);
          const sbBottom = Math.max(selectionBox.startY, selectionBox.currentY);

          // Small box threshold needs to account for zoom if we want pixel feel, 
          // but 5 world units is fine generally.
          if (Math.abs(sbRight - sbLeft) < 5 && Math.abs(sbBottom - sbTop) < 5) {
               if (!e.shiftKey) setSelectedNoteIds(new Set());
          } else {
               const newSelected = new Set(e.shiftKey ? selectedNoteIds : []);
               notes.forEach(note => {
                  const nLeft = note.x;
                  const nTop = note.y;
                  const nRight = note.x + note.width;
                  const nBottom = note.y + note.height;

                  // AABB Intersection
                  if (sbLeft < nRight && sbRight > nLeft && sbTop < nBottom && sbBottom > nTop) {
                      newSelected.add(note.id);
                  }
               });
               setSelectedNoteIds(newSelected);
          }
          
          setSelectionBox(prev => ({ ...prev, isVisible: false, width: 0, height: 0 }));
      }

      // Finalize Drag
      if (dragState.isDragging && dragState.noteId) {
        const sourceId = dragState.noteId;
        const targetId = overlapTargetId;

        setDragState({ isDragging: false, noteId: null, startX: 0, startY: 0, initialNoteX: 0, initialNoteY: 0 });
        setOverlapTargetId(null);

        // 1. Merge Logic
        if (targetId) {
          const sourceNote = notes.find(n => n.id === sourceId);
          const targetNote = notes.find(n => n.id === targetId);

          if (sourceNote && targetNote) {
            // Optimistic Update
            const connectionsToRemove = connections.filter(c => c.fromId === sourceId || c.toId === sourceId);
            const newConnections = connections.filter(c => c.fromId !== sourceId && c.toId !== sourceId);

            setNotes(prev => prev.map(n => {
                if (n.id === targetId) return { ...n, isProcessing: true };
                return n;
            }).filter(n => n.id !== sourceId)); // Remove source
            
            setConnections(newConnections);
            setSelectedNoteIds(prev => { const n = new Set(prev); n.delete(sourceId); return n; });

            // Async Operation
            mergeNotes(sourceNote.content, targetNote.content)
              .then(mergedContent => {
                  const currentNotes = notesRef.current;
                  const target = currentNotes.find(n => n.id === targetId);
                  
                  // SAFEGUARD: If target is missing or NOT processing, it means user probably Undid the action
                  // or state drastically changed. Do not apply update to avoid zombie notes.
                  if (!target || !target.isProcessing) return;
                  
                  const finalNotes = currentNotes.map(n => 
                    n.id === targetId 
                      ? { ...n, content: mergedContent, isProcessing: false, zIndex: nextZIndex.current++ } 
                      : n
                  );
                  
                  setNotes(finalNotes);
                  
                  // Use ref to access latest pushHistory and push the NEW state
                  pushHistoryRef.current(finalNotes, newConnections);
              })
              .catch(err => {
                  console.error("Merge failed", err);
                  // Revert: Add back source note, stop processing target
                  setNotes(current => {
                      const withTargetReset = current.map(n => n.id === targetId ? { ...n, isProcessing: false } : n);
                      // Restore source note if it's not there (checking collision might be needed but simple restore is safer for now)
                      if (!current.find(n => n.id === sourceId)) {
                          return [...withTargetReset, sourceNote];
                      }
                      return withTargetReset;
                  });
                  // Restore connections
                  setConnections(prev => [...prev, ...connectionsToRemove]);
              });
          }
        } 
        // 2. Simple Move - Record History
        else {
            pushHistory(notes, connections);
        }
      }
  };

  useEffect(() => {
    if (dragState.isDragging || selectionBox.isVisible || isPanning || (toolMode === 'connect' && connectionStartId)) {
      window.addEventListener('mousemove', handleMouseMove);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [dragState.isDragging, selectionBox.isVisible, isPanning, toolMode, connectionStartId, handleMouseMove]);


  return (
    <div 
      className={`w-full h-screen overflow-hidden bg-[#f3f4f6] relative pattern-grid selection:bg-blue-200 
        ${isPanning ? 'cursor-grabbing' : toolMode === 'hand' ? 'cursor-grab' : toolMode === 'connect' ? 'cursor-crosshair' : ''}`}
      onMouseDown={handleStageMouseDown}
      onMouseUp={handleStageMouseUp}
      ref={containerRef}
    >
      {/* --- Header --- */}
      <div className="absolute top-4 left-4 z-40 flex items-center gap-4 pointer-events-none">
        <h1 className="text-2xl font-bold text-gray-800 tracking-tight pointer-events-auto">IdeaMix</h1>
        <div className="bg-white/60 backdrop-blur-sm px-3 py-1 rounded-full text-sm text-gray-600 flex items-center gap-2 border border-white/20 shadow-sm pointer-events-auto">
            <Info size={14} />
            <span>
              {toolMode === 'hand' ? '화면 이동 모드 (드래그하여 이동)' : 
               toolMode === 'connect' ? '연결 모드 (노트 드래그하여 연결/해제)' :
               '선택 모드 (드래그하여 선택/이동, 겹쳐서 병합)'}
            </span>
        </div>
        {/* Undo/Redo Buttons */}
        <div className="flex gap-1 bg-white rounded-lg shadow-sm border border-gray-200 p-1 pointer-events-auto">
            <button 
                onClick={undo} 
                disabled={historyIndex <= 0}
                className={`p-1.5 rounded hover:bg-gray-100 ${historyIndex <= 0 ? 'text-gray-300' : 'text-gray-600'}`}
                title="실행 취소"
            >
                <Undo2 size={18} />
            </button>
            <button 
                onClick={redo} 
                disabled={historyIndex >= history.length - 1}
                className={`p-1.5 rounded hover:bg-gray-100 ${historyIndex >= history.length - 1 ? 'text-gray-300' : 'text-gray-600'}`}
                title="다시 실행"
            >
                <Redo2 size={18} />
            </button>
        </div>
      </div>

      {/* --- Top Right Action Bar --- */}
      <div className="absolute top-4 right-4 z-40 flex flex-col gap-2 pointer-events-none items-end">
         <div className="flex gap-2">
            {selectedNoteIds.size > 0 && (
                <>
                <button 
                    onClick={downloadMarkdown}
                    className="p-2 bg-white hover:bg-blue-50 text-blue-600 rounded-full shadow-md transition-colors z-50 pointer-events-auto"
                    title="마크다운 내보내기"
                >
                    <Download size={20} />
                </button>
                <button 
                    onClick={deleteSelected}
                    className="p-2 bg-white hover:bg-red-50 text-red-500 rounded-full shadow-md transition-colors z-50 pointer-events-auto"
                    title="선택 삭제"
                >
                    <Eraser size={20} />
                </button>
                </>
            )}
            {notes.length > 0 && (
                <button 
                    onClick={clearAll}
                    className="p-2 bg-white/80 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-full shadow-sm transition-colors pointer-events-auto"
                    title="모두 지우기"
                >
                    <Eraser size={20} />
                </button>
            )}
         </div>
      </div>

      {/* --- Tool Bar (Bottom Right or Side) --- */}
      <div className="absolute bottom-24 right-4 z-40 flex flex-col gap-2 pointer-events-auto">
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-1 flex flex-col gap-1">
             <button 
                onClick={() => setToolMode('select')}
                className={`p-2 rounded-md transition-colors ${toolMode === 'select' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`}
                title="선택 도구"
             >
                <MousePointer2 size={20} />
             </button>
             <button 
                onClick={() => setToolMode('connect')}
                className={`p-2 rounded-md transition-colors ${toolMode === 'connect' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`}
                title="연결 도구"
             >
                <Network size={20} />
             </button>
             <button 
                onClick={() => setToolMode('hand')}
                className={`p-2 rounded-md transition-colors ${toolMode === 'hand' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`}
                title="이동(팬) 도구"
             >
                <Hand size={20} />
             </button>
          </div>

          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-1 flex flex-col gap-1">
             <button onClick={zoomIn} className="p-2 text-gray-600 hover:bg-gray-100 rounded-md" title="확대">
                <ZoomIn size={20} />
             </button>
             <div className="text-xs text-center font-medium text-gray-500 py-1">
                {Math.round(viewState.scale * 100)}%
             </div>
             <button onClick={zoomOut} className="p-2 text-gray-600 hover:bg-gray-100 rounded-md" title="축소">
                <ZoomOut size={20} />
             </button>
             <button onClick={handleAutoFit} className="p-2 text-gray-600 hover:bg-gray-100 rounded-md border-t border-gray-100" title="Autofit (자동 정렬 및 맞춤)">
                <Maximize size={16} />
             </button>
             <button onClick={handleExportSVG} className="p-2 text-gray-600 hover:bg-gray-100 rounded-md border-t border-gray-100" title="보드 캡쳐 (SVG)">
                <ImageDown size={16} />
             </button>
          </div>
      </div>

      {/* --- World Container --- */}
      <div 
        className="w-full h-full origin-top-left transition-transform duration-75 ease-out will-change-transform"
        style={{
            transform: `translate(${viewState.x}px, ${viewState.y}px) scale(${viewState.scale})`
        }}
      >
        {/* Snap Guides */}
        {snapLines.map((line, i) => (
            <div
            key={i}
            className={`absolute bg-indigo-500/60 z-30 pointer-events-none ${
                line.type === 'vertical' ? 'w-px h-full top-0' : 'h-px w-full left-0'
            }`}
            style={{
                // Adjust thickness based on zoom to keep it visible but thin
                [line.type === 'vertical' ? 'width' : 'height']: `${1 / viewState.scale}px`,
                left: line.type === 'vertical' ? line.position : -10000, // Extend far
                top: line.type === 'horizontal' ? line.position : -10000,
                right: line.type === 'horizontal' ? -10000 : 'auto',
                bottom: line.type === 'vertical' ? -10000 : 'auto',
            }}
            />
        ))}
        
        {/* Connection Layer (Below Notes) */}
        <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-0">
             <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                </marker>
             </defs>
             {/* Existing Connections */}
             {connections.map(conn => {
                 const fromNote = notes.find(n => n.id === conn.fromId);
                 const toNote = notes.find(n => n.id === conn.toId);
                 if (!fromNote || !toNote) return null;
                 
                 const start = getNoteCenter(fromNote);
                 const end = getNoteCenter(toNote);
                 
                 return (
                     <line 
                        key={conn.id}
                        x1={start.x} y1={start.y}
                        x2={end.x} y2={end.y}
                        stroke="#94a3b8"
                        strokeWidth={2}
                        // markerEnd="url(#arrowhead)" // Optional: Add directionality
                     />
                 );
             })}
             
             {/* Dragging Connection Draft */}
             {toolMode === 'connect' && connectionStartId && dragTargetPos && (() => {
                 const startNote = notes.find(n => n.id === connectionStartId);
                 if (!startNote) return null;
                 const start = getNoteCenter(startNote);
                 return (
                     <line 
                        x1={start.x} y1={start.y}
                        x2={dragTargetPos.x} y2={dragTargetPos.y}
                        stroke="#6366f1"
                        strokeWidth={2}
                        strokeDasharray="5,5"
                     />
                 );
             })()}
        </svg>

        <div className={`w-full h-full relative ${toolMode === 'hand' ? 'pointer-events-none' : ''}`}>
            {notes.map((note) => (
            <NoteItem
                key={note.id}
                note={note}
                scale={viewState.scale} 
                toolMode={toolMode}
                onMouseDown={handleNoteMouseDown}
                onMouseUp={handleNoteMouseUp}
                onDelete={handleDelete}
                onEdit={handleEdit}
                onResize={handleResize}
                onResizeEnd={handleResizeEnd}
                onOutline={handleOutline}
                onGenerateRelated={handleGenerateRelated}
                onColorChange={handleColorChange}
                isOverlapTarget={overlapTargetId === note.id}
                isSelected={selectedNoteIds.has(note.id)}
            />
            ))}

            {selectionBox.isVisible && (
            <div 
                className="absolute border-2 border-indigo-500 bg-indigo-500/10 pointer-events-none z-50 rounded-sm"
                style={{
                    left: Math.min(selectionBox.startX, selectionBox.currentX),
                    top: Math.min(selectionBox.startY, selectionBox.currentY),
                    width: Math.abs(selectionBox.currentX - selectionBox.startX),
                    height: Math.abs(selectionBox.currentY - selectionBox.startY),
                    borderWidth: `${2 / viewState.scale}px` // Keep border width consistent on screen
                }}
            />
            )}
        </div>
      </div>
        
      <ChatInput 
         onSend={handleChatAction} 
         isLoading={isGenerating} 
         selectedCount={selectedNoteIds.size}
      />
    </div>
  );
};

export default App;