
export interface Note {
  id: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  zIndex: number;
  isProcessing?: boolean; // For merge loading state
}

export interface Connection {
  id: string;
  fromId: string;
  toId: string;
}

export interface GeneratedIdeasResponse {
  ideas: string[];
}

export type DragState = {
  isDragging: boolean;
  noteId: string | null;
  startX: number;
  startY: number;
  initialNoteX: number;
  initialNoteY: number;
};

export interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  width: number;
  height: number;
  isVisible: boolean;
}

export interface SnapLine {
  type: 'horizontal' | 'vertical';
  position: number;
}

export const COLORS = [
  'bg-yellow-200',
  'bg-green-200',
  'bg-blue-200',
  'bg-red-200',
  'bg-purple-200',
  'bg-orange-200',
  'bg-pink-200',
  'bg-teal-200',
];
