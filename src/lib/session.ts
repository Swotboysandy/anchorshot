import type { Correction, FrameAsset, ObjectMask } from '../types';

export interface EditSession {
  asset: FrameAsset | null;
  masks: ObjectMask[];
  selectedId: string | null;
  candidate: Correction | null;
  approved: Correction | null;
  color: string;
}
export const initialSession: EditSession = {
  asset: null,
  masks: [],
  selectedId: null,
  candidate: null,
  approved: null,
  color: '#4169d8',
};
export type EditAction =
  | { type: 'load'; asset: FrameAsset }
  | { type: 'masks'; masks: ObjectMask[]; sourceHash: string }
  | { type: 'select'; id: string }
  | { type: 'color'; color: string }
  | { type: 'preview'; correction: Correction }
  | { type: 'approve' | 'reject' | 'undo' };

export function editSession(state: EditSession, action: EditAction): EditSession {
  switch (action.type) {
    case 'load':
      return { ...initialSession, color: state.color, asset: action.asset };
    case 'masks': {
      if (state.asset?.hash !== action.sourceHash) return state;
      if (
        action.masks.some(
          (mask) =>
            mask.sourceHash !== action.sourceHash ||
            mask.width !== state.asset?.width ||
            mask.height !== state.asset?.height,
        )
      )
        return state;
      return {
        ...state,
        masks: action.masks,
        selectedId: action.masks.length === 1 ? action.masks[0].id : null,
        candidate: null,
        approved: null,
      };
    }
    case 'select':
      return state.masks.some((mask) => mask.id === action.id)
        ? { ...state, selectedId: action.id, candidate: null, approved: null }
        : state;
    case 'color':
      return { ...state, color: action.color, candidate: null };
    case 'preview':
      return action.correction.sourceHash === state.asset?.hash &&
        action.correction.selectionId === state.selectedId &&
        action.correction.color === state.color
        ? { ...state, candidate: action.correction }
        : state;
    case 'approve':
      return state.candidate &&
        state.candidate.report.changedOutside === 0 &&
        state.candidate.report.changedInside > 0
        ? { ...state, approved: state.candidate, candidate: null }
        : state;
    case 'reject':
      return { ...state, candidate: null };
    case 'undo':
      return { ...state, candidate: null, approved: null };
  }
}
